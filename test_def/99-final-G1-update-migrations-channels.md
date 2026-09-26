# Update, migrations and channels — final tests

This domain covers `omarchy update` end to end from the menu and from a terminal on the 4.0.2 disk
(the eleven stable migrations, the `Restart Kitty` box, the `linux-omarchy` kernel reboot prompt, the
"nothing to do" second run after the reboot, `-y` still asking `Reboot?`), the bar's update indicator
and the `Ready to update?` cancel paths, the update's negatives (Omarchy's own lock, pacman `db.lck`,
under 10 GiB via `fallocate`, the unowned-file conflict healer, a failed migration stopping the queue,
a bogus mirrorlist), the single `pacman -Syu` "Woah partner" guard test, `omarchy-migrate` idempotence
and the login notifier plus four hand-run migration scripts, channels (current, refusals, switch to
edge/dev and back), the `omarchy version` family, the `omarchy-upgrade-to-quattro` refusals (answer
**No**, never Yes), the reinstall cancel/configs-reset paths, keyring/orphans, the Update menu's
rows (Process → Shell, Config → Shell, Hardware, Firmware, Time, Extra Themes), the post-update
invitation hook, and — because the classifier routed every one of them here — Remove/Install →
Preinstalls. 102 source blocks + 11 routed in from A1/A2/H = 113 → 36 tests (99 blocks merged),
1 not runnable (2 blocks), 12 moved, 0 dropped, 0 rerouted. Routing pass: all eleven incoming blocks
folded into existing tests — four more "Woah partner" proposals into `pacman-direct-upgrade-guard`
(now reaching the real hook with `sudo pacman -Syu --ignore '*' bash`, its exact prompts and pacman's
`failed to run transaction hooks` error), the pacman `db.lck` refusal and `omarchy-migrate`'s
`Waiting for pacman transaction…` into `update-keyring-passes-and-fails-cleanly`, the two-pending toast
and the real logout/login path into `migrate-idempotent-and-login-notifier`, 51's custom-config repair
matrix into `post-update-kitty-config-refreshed`, the snapshot-before-packages proof into
`update-menu-omarchy`, and the snapper check into the overlap test. Notable merges: seven indicator/cancel blocks became one `update-indicator-click-and-cancel`
(cancel asserted as exit 0 `Done!` per 01-FACTS, with the 4.0.2 `Failed (exit code 1)` reading recorded
as drift); six migrate/notifier blocks became `migrate-idempotent-and-login-notifier` (un-marking the
harmless 1786517850 and firing the notifier with `systemctl --user restart`); six channel blocks became
`channel-current-menu-check-and-refusals`; six preinstalls blocks became one remove story; the four
"Woah partner" proposals became one test that reaches the real alpm hook with a one-package
transaction (a bare `sudo pacman -Syu` would download every upgrade before the hook fires — 52's
"before sync" reading corrected); the RC round trips were folded into the edge switch as the same flow.
Operator note encoded in every `post-update-*` test: they run on the disk left by `update-menu-omarchy`
(updated **and rebooted**; `save` it) or, for `post-update-edge-*`, by `channel-switch-edge-and-update`;
on a pristine disk each first has to run that SLOW update. `03-INTENDED-BEHAVIOUR.md` verdicts applied:
item 10 (`omarchy update -y` still asks `Reboot?` — MANUAL-INTENDED, issue #8986/#8780) so
`update-terminal-run` and `post-update-second-run-nothing-to-do` assert that `-y` never prompts and record
the observed gum box as the defect; item 9 (`omarchy-upgrade-to-quattro` has no "already on 4.x" guard —
UNCLEAR) so the quattro test records that no such notice appears and never answers Yes; item 21
(`Update → Config` per-group restore with `.bak.<epoch>` — CODE-INTENDED) matches the Config → Shell
test as written. The cancel exit code (`Done!` at HEAD vs `Failed (exit code 1)` read by two reviewers on
4.0.2) is not in the verdict file: asserted as `Done!` per 01-FACTS with the other reading recorded as
build drift. `Update → Timezone` is not in this slice (B and H hold it).

## Tests

### update-menu-omarchy   [VM-OK] [NET] [SLOW]
description: Update → Omarchy carries the 4.0.2 disk to the current stable release end to end — confirm box, snapshot, keyring, packages, the eleven migrations added since 4.0.2 (Kitty config box, `linux-omarchy` kernel), the one-time post-update invitations, the kernel reboot prompt answered Yes — and comes back on the new version with the update icon gone. This is the run whose disk every `post-update-*` test reuses: `save` it.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy-version; omarchy-channel-current; sudo snapper list | tail -n 3` (password `prime`) — `4.0.2-…`, `stable`, and note the existing snapshot rows. Note the circle-arrows update icon right of the clock in the bar. Close the terminal with Super+W.
  * Open the Omarchy menu with Super+Space and click `Update`, then `Omarchy`, with the mouse.
  ** A floating terminal shows the Omarchy logo, then a boxed `Ready to update?` text ("You cannot stop the update once you start!", a link to the releases page) ending in `Continue with update?` with Yes/No. Choose Yes (Enter). Type `prime` at `[sudo] password for prime:` — it can reappear during a long run.
  * Watch the run and screenshot every few seconds so the scrolling text is captured. Green headings in order: `Prune package cache`, `Create system snapshot` (`Snapshots can be selected during boot.` — or a yellow `Continuing the update without a snapshot` / `No Snapper configs found` warning: record which), `Update Arch signing keys` / `Keys are correct`, `Update system packages` with pacman downloading and installing, then `Running migration (<number>)` lines each followed by a one-line description, then `Update mise tools`.
  ** The snapshot step must come **before any pacman download output** — that is what lets a bad update be rolled back from Limine. Never Ctrl+C once started.
  ** Expected migration numbers on a stable update — eleven: 1787215483, 1787760281, 1787843905, 1788577553, 1788619462, 1788662350, 1788724825, 1788745941, 1788848726, 1789325478, 1789444024. Note any difference.
  ** Under `Running migration (1788745941)` a red `Replaced /home/prime/.config/kitty/kitty.conf with new Omarchy default.` line, a diff, and a rounded box `Restart Kitty` / `Close and reopen all Kitty windows to apply this change.` must appear. Under `(1789325478)` pacman installs `linux-omarchy`.
  ** The Stay Awake indicator is lit in the bar while packages download and must be off again after `Restarting shell`. After the migrations the post-update hook fires two one-time toasts, **Install Dictation with Voxtype** and **Set your default agent** — do not click the Voxtype one. If `Remove N orphaned package(s)?` appears answer No. No red `Something went wrong during the update!` may appear.
  * At the end the question `Linux kernel has been updated. Reboot?` (or `Updates require reboot. Ready?`) appears. Screenshot it, then answer Yes.
  ** A `Rebooting` OSD shows, windows close, the machine reboots. Type `prime` blind at the Plymouth passphrase prompt (one try; a wrong passphrase re-prompts — never three wrong); autologin lands on the desktop.
  * Back on the desktop the update icon right of the clock must be gone. Open a terminal and type `omarchy-version; uname -r; pacman -Q linux-omarchy; omarchy-migrate --pending; echo pending=$?; omarchy-update-available; sudo snapper list | tail -n 3`.
  ** The version is newer than at the start (expected `4.0.4-…`), `uname -r` is no longer the ISO kernel, `linux-omarchy` is listed, nothing is pending, `pending=1`, `Omarchy is up to date`, and one new snapshot row whose description is the **old** version (`4.0.2-…`) — the pre-update snapshot.
  * Confirm the bar is drawn and Super+Space opens the menu. End the session with `save`: this disk is the base for the `post-update-*` tests.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The download phase is well over five minutes on user-mode NAT; never sleep more than five seconds between screenshots. If the budget runs out, report the last screenshot and the exact heading reached as "incomplete — time", not as a failure.
  * gum questions accept `y`/`n` as well as Enter on the highlighted button; Enter on `Continue with update?` means Yes.
  * The red block `Something went wrong during the update!` followed by `● Failed (exit code N)! Press any key to close...` is the failure signature. Before rebooting, `tail -n 80 /tmp/omarchy-update.log | sudo tee /dev/ttyS0` gets the transcript into `get-serial`; after the reboot /tmp is gone and the screenshots are the transcript.
  * The menu filters as you type, but this test wants the mouse for the two menu clicks.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the `Ready to update?` box, the sudo prompt, `Create system snapshot` before any pacman output, `Keys are correct`, `Update system packages` in progress, the `Running migration` lines (all eleven visible across screenshots), the `Restart Kitty` box, the two invitation toasts, the Stay Awake indicator lit then off, the reboot question, the `Rebooting` OSD, the Plymouth prompt
  ** Post-reboot terminal with the new version, `uname -r`, `linux-omarchy`, `pending=1`, `Omarchy is up to date` and the snapper row described with the old version; bar screenshot without the update icon
  * If unsuccessful
  ** The screenshot with the red `Something went wrong during the update!` banner or `Failed (exit code N)` and the 30 lines above it, or package output preceding the snapshot step; the serial transcript tail if taken before the reboot; if the machine does not come back, the Limine menu / emergency shell plus `get-serial`
covers: bin/omarchy-update (:30-38 snapshot before packages), bin/omarchy-update-confirm, bin/omarchy-update-pkg-prune, bin/omarchy-snapshot create, bin/omarchy-update-keyring, bin/omarchy-update-system-pkgs, bin/omarchy-update-stay-awake, bin/omarchy-migrate, migrations 1787215483…1789444024 (1788745941 Kitty, 1789325478 kernel), bin/omarchy-update-restart, bin/omarchy-system-reboot, bin/omarchy-update-status, bin/omarchy-update-available, bin/omarchy-hook post-update, default/omarchy/omarchy-menu.jsonc update.omarchy, shell/plugins/bar/widgets/SystemUpdate.qml, docs/update-process.md (Path 1), manual/30-updates.md, manual/47:3, test/shell.d/update-sequence-test.sh, snapshot-create-test.sh, omarchy-kernel-migration-test.sh, update-pkg-prune-test.sh
merged-from: 43:update-menu-omarchy; 24:update-omarchy-end-to-end; 12:update-full-run; 52:omarchy-update-full-sequence; 13:update-creates-snapshot-before-packages

### update-terminal-run   [VM-OK] [NET] [SLOW]
description: `omarchy update -y` typed in a terminal runs the same pipeline as the menu without the confirm box and — by the documented contract, "a promise not to ask anything" — must not stop at a `Reboot?` or orphan question either (it should print that a reboot is required and end `Done!`); at HEAD it still shows the gum `Linux kernel has been updated. Reboot?` box, the pinned defect (#8986). Its transcript in /tmp/omarchy-update.log shows the pacman guard letting the update through and the Hyprland reload hooks pausing and resuming, a snapper snapshot labelled with the old version exists, and an installed post-update hook fired. The reboot is not taken here, so the reboot-required marker stays: reboot before this disk is reused.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy-version; sudo snapper list | tail -2` (password `prime`). Note the version (`4.0.2-…`) and the last snapshot number.
  * Type `printf '#!/bin/bash\ndate > /tmp/post-update-ran\n' > /tmp/pu.sh; omarchy hook install post-update /tmp/pu.sh`.
  ** If `omarchy hook install` is an unknown command on this build, record "absent on this build" and skip the hook checks below.
  * Type `omarchy update -y`.
  ** No `Ready to update?` box: the first output is `Prune package cache`, then the sudo prompt (type `prime`). The same headings as the menu path follow — `Create system snapshot`, `Update Arch signing keys`, `Update system packages`, eleven `Running migration (…)` lines (the `Restart Kitty` box under 1788745941, `linux-omarchy` under 1789325478), `Update mise tools`. Under `-y` an orphan section must only list and ask nothing; if `Remove N orphaned package(s)?` is asked anyway, answer No and record it as the unattended-prompt defect.
  * At the reboot step the intended behaviour under `-y` is **no question**: a printed line that a reboot is required, then `Done!`. If the gum box `Linux kernel has been updated. Reboot?` (or `Updates require reboot. Ready?`) appears instead — it does at HEAD — screenshot it, answer **No**, and record the prompt as the defect (the run is otherwise correct).
  ** Green `Restarting shell` / `All plugins have been reloaded` follow; the bar blinks off and on.
  * Type `omarchy-version; sudo snapper list | tail -2; cat /tmp/post-update-ran; ls ~/.local/state/omarchy/reboot-required`.
  ** The new version (expected `4.0.4-…`), one new snapshot whose description is the old version string, a date written by the hook, and the reboot marker present.
  * Type `grep -n 'Woah partner\|Checking Omarchy update entrypoint\|Pausing Hyprland\|Reloading Hyprland\|Running migration' /tmp/omarchy-update.log | sudo tee /dev/ttyS0` and read it with `get-serial`.
  ** `Checking Omarchy update entrypoint...`, `Pausing Hyprland config auto-reload…` and `Reloading Hyprland after Omarchy settings update...` are present; `Woah partner` is absent; the `Running migration` lines match what you saw.
  * Type `omarchy-hyprland-reload-guard paused; echo paused=$?; hyprctl getoption misc:disable_autoreload | grep int; flock -n $XDG_RUNTIME_DIR/omarchy-update.lock true; echo lock-free=$?` — `paused` non-zero, `int: 0` (the settings upgrade left Hyprland's auto-reload enabled), `lock-free=0`.
  * Type `rm ~/.config/omarchy/hooks/post-update.d/pu.sh`. Then reboot via Super+Escape → Reboot (passphrase `prime`) before this disk is reused for any `post-update-*` test — or end with `stop`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The run is long (> 5 min); screenshot repeatedly instead of sleeping. Report "incomplete — time" with the last heading if the budget runs out.
  * Not rebooting leaves the `reboot-required` marker in place; the next update will raise the reboot step again — that is why the reboot must happen before `post-update-second-run-nothing-to-do`.
  * docs/update-process.md: "`-y` exports `OMARCHY_UPDATE_UNATTENDED=1` — a promise not to ask anything. Steps that would prompt … report and skip instead of blocking." Any gum question under `-y` is therefore a defect to record, never a reason to fail the rest of the run.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the run starting at `Prune package cache` with no confirm box, the migration lines, the reboot step — intended: a printed reboot-required line and `Done!` with no question; observed HEAD: the `Reboot?` box, screenshotted and answered No, recorded as the defect — `Restarting shell`, the new version with the new snapshot row described with the old version, the hook's date and the marker, and the `paused`/`int: 0`/`lock-free=0` line
  ** Serial log containing the grep with the hook lines and no `Woah partner`
  * If unsuccessful
  ** Screenshot of the failing step, a `Ready to update?` box under `-y`, or the update stopping without `Restarting shell`; `sudo cat /tmp/omarchy-update.log | sudo tee /dev/ttyS0` then `get-serial`; `pgrep -a pacman`
covers: bin/omarchy-update (-y / OMARCHY_UPDATE_UNATTENDED, script transcript, free-space check, prune, snapshot), bin/omarchy-update-restart, bin/omarchy-snapshot, bin/omarchy-update-pacman, bin/omarchy-hyprland-reload-guard, bin/omarchy-hook (post-update.d), bin/omarchy-update-lock, default/libalpm/hooks/00-omarchy-update-guard.hook, 10-omarchy-hyprland-reload-pause.hook, 90-omarchy-hyprland-reload-resume.hook, docs/update-process.md "Path 1", "State and coordination files", "Raw pacman guard", "Update-related binaries", "-y exports OMARCHY_UPDATE_UNATTENDED=1", default/agents/skills/omarchy/hooks.md (post-update.d), test/shell.d/update-sequence-test.sh, update-pacman-guard-test.sh "allows omarchy update pacman call"
merged-from: 43:update-terminal-run; 61:update-full-run

### post-update-second-run-nothing-to-do   [VM-OK] [NET]
description: On the disk left by `update-menu-omarchy` — updated and rebooted — `omarchy update` is a short, safe no-op: `-y` skips the confirm box, the snapshot and keyring steps still run, pacman says there is nothing to do, no migration runs, no reboot is asked, and the menu path ends with `Done!`; the update checker then reports Omarchy is up to date.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Precondition: the disk left by `update-menu-omarchy`. Open a terminal with Super+Enter and type `omarchy-version; omarchy-update-available; echo exit=$?; ls ~/.local/state/omarchy/reboot-required 2>&1` — `4.0.4-…`, `Omarchy is up to date`, `exit=1`, `No such file or directory`.
  ** If the marker exists the disk was updated but not rebooted and the kernel prompt would re-ask: reboot from Super+Escape → Reboot (passphrase `prime`) first, then start over.
  ** If the version is still `4.0.2-…` this test becomes SLOW: run `update-menu-omarchy` first (Yes to the reboot) and come back.
  * Type `omarchy update -y`.
  ** No `Ready to update?` box: the first output is `Prune package cache`, then the sudo prompt (type `prime`). Then `Create system snapshot`, `Update Arch signing keys` / `Keys are correct`, `Update system packages` followed by pacman's ` there is nothing to do`, **no** `Running migration` line, `Update mise tools`.
  ** If an `Orphan system packages` list appears it must end with `… found. Re-run omarchy-update-orphan-pkgs in a terminal to review/remove them.` and ask nothing; a `Remove N orphaned package(s)?` question under `-y` is the unattended-prompt defect — answer No and record it.
  * The run ends with `Restarting shell` / `All plugins have been reloaded` and the prompt returns with no reboot question.
  ** A `Reboot?` question here means the precondition disk was not rebooted (the marker was present): answer No and report the precondition, not this test — and note that `-y` asking at all is the defect pinned by `update-terminal-run`.
  * Open the Omarchy menu with Super+Space → `Update` → `Omarchy` with the mouse. Press Enter at `Continue with update?`, type `prime` at the sudo prompt: the same banners, ` there is nothing to do`, no migration, no reboot prompt, then `● Done! Press any key to close...`. Press a key; it closes.
  * In the terminal type `sudo snapper list | tail -n 3; omarchy-update-available; echo exit=$?; omarchy-migrate --pending; echo pending=$?; omarchy-migrate; echo migrate=$?` — the newest snapshot rows are from these runs (today's time, description = the version), `Omarchy is up to date` / `exit=1`, nothing listed, `pending=1`, no output from `omarchy-migrate`, `migrate=0`. The bar shows no update icon right of the clock.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The keyring step still contacts the mirror on every run, so this needs network even though nothing is installed; each run takes about a minute, the snapshot step being the slowest.
  * gum prompts default to Yes; Enter accepts.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the run starting without a confirm box, ` there is nothing to do` with no `Running migration` line, the orphan section (if any) without a question, `Restarting shell`, the menu run ending `● Done!`, the snapper rows, `Omarchy is up to date` / `exit=1`, `pending=1` and the silent `omarchy-migrate`; bar without the update icon
  * If unsuccessful
  ** Screenshot of a confirm box or orphan question under `-y`, any `Running migration` line, a reboot prompt, or the red failure block; `sudo cat /tmp/omarchy-update.log | sudo tee /dev/ttyS0` then `get-serial`
covers: bin/omarchy-update (-y / OMARCHY_UPDATE_UNATTENDED), bin/omarchy-update-orphan-pkgs, bin/omarchy-update-restart, bin/omarchy-update-keyring, bin/omarchy-migrate (idempotence), bin/omarchy-update-available, bin/omarchy-update-status, omarchy-snapshot, default/snapper/root, docs/update-process.md "-y exports OMARCHY_UPDATE_UNATTENDED=1", test/shell.d/update-orphan-test.sh, update-status-test.sh, migrate-scope-test.sh "skips completed migrations"
merged-from: 43:update-second-run-nothing-to-do; 24:update-already-up-to-date-second-run

### post-update-kernel-omarchy   [VM-OK]
description: After the stable update the machine runs the `linux-omarchy` kernel: the package and headers are installed, Limine's BOOT_ORDER puts it first, the Limine tree lists it with the ISO kernel kept as a fallback, `uname -r` no longer shows the ISO kernel, and the reboot-required marker is gone.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Precondition: the disk left by `update-menu-omarchy` (updated and rebooted). Open a terminal with Super+Enter and type `omarchy-version`.
  ** If it still prints `4.0.2-…` this test becomes SLOW: note `uname -r`, type `omarchy update -y`, type `prime` at sudo prompts, answer Yes to `Linux kernel has been updated. Reboot?` (or `Updates require reboot. Ready?`), enter the passphrase `prime` and log in.
  * Type `uname -r; pacman -Q linux-omarchy linux-omarchy-headers`.
  ** Both packages are listed; `uname -r` is not the ISO kernel string — report the exact value (the Omarchy kernel).
  * Type `grep BOOT_ORDER /etc/default/limine`.
  ** Exactly `BOOT_ORDER="linux-omarchy, linux-omarchy-*, *, *fallback, Snapshots"`.
  * Type `sudo limine-entry-tool --tree | sudo tee /dev/ttyS0` (password `prime`) and read the serial log: an entry for `linux-omarchy` is present, and the previous kernel is still listed as a fallback choice.
  * Type `ls ~/.local/state/omarchy/reboot-required; omarchy-migrate --pending; echo pending=$?` — `No such file or directory`, nothing pending, `pending=1`.
  * Close the terminal with Super+W; nothing was changed.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If the Limine boot menu is visible during a precondition reboot, screenshot it: the first entry names linux-omarchy.
  * The old kernel stays installed on purpose so the user can boot it from Limine if the new one fails.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of `uname -r` with both packages, the BOOT_ORDER line, the serial dump of the Limine tree with linux-omarchy, and the absent reboot marker with `pending=1`
  * If unsuccessful
  ** Screenshot of `The Omarchy kernel has no Limine boot entry; rerun omarchy-migrate…`, a missing package, a wrong BOOT_ORDER, or a boot that does not reach the desktop (Limine menu / emergency shell) plus `get-serial`
covers: migrations/1789325478.sh, migrations/1789444024.sh, bin/omarchy-update-restart, bin/omarchy-state, test/shell.d/omarchy-kernel-migration-test.sh, kernel-headers-migration-test.sh
merged-from: 43:post-update-kernel-omarchy

### post-update-kitty-config-refreshed   [VM-OK]
description: The Kitty migration replaced the stock 4.0.2 `~/.config/kitty/kitty.conf` with the new default, kept a timestamped backup and showed the `Restart Kitty` box during the update; re-run on a customised file it only comments out the insecure `allow_remote_control yes`/`true` lines while keeping every other line, its order, restricted modes (`socket-only`, `socket`) and the file mode, saves a backup, and is silent on an identical rerun.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Precondition: the disk left by `update-menu-omarchy`. Open a terminal with Super+Enter and type `omarchy-version`.
  ** If it still prints `4.0.2-…` this test becomes SLOW: type `omarchy update -y`, type `prime` at sudo prompts, watch for the `Restart Kitty` box under `Running migration (1788745941)`, and answer No to the reboot question.
  * Type `ls ~/.config/kitty/; head -1 ~/.config/kitty/kitty.conf; grep -c 'allow_remote_control yes' ~/.config/kitty/kitty.conf`.
  ** `kitty.conf` plus one `kitty.conf.bak.<digits>`; first line `# Remove the include below to disconnect Kitty from Omarchy's theming system.`; count `0`.
  * Type `grep -c 'allow_remote_control yes' ~/.config/kitty/kitty.conf.bak.*` — `1` (the backup is the old file).
  * Type `printf '\nallow_remote_control yes\n# my line\n' >> ~/.config/kitty/kitty.conf; rm ~/.local/state/omarchy/migrations/1788745941.sh; omarchy-migrate`.
  ** `Running migration (1788745941)`, `Unrestricted remote control disabled.`, `Your other Kitty settings were preserved.`, `Backup saved to:` with a `.bak.XXXXXX` path, and the rounded `Restart Kitty` / `Close and reopen all Kitty windows to apply this change.` box.
  * Type `grep -n 'allow_remote_control\|my line' ~/.config/kitty/kitty.conf` — `# allow_remote_control yes` (commented) and `# my line` both present.
  ** One reviewer reads the box as appearing only when a stock config is replaced (a custom config repaired quietly): record whether the `Restart Kitty` box appeared on this re-run.
  * Fully custom file: type `cp ~/.config/kitty/kitty.conf /tmp/kitty.orig; printf '# my comment\ninclude my-theme.conf\nfont_size 13\nallow_remote_control yes\nallow_remote_control true\nallow_remote_control socket-only\nlisten_on unix:/tmp/my-kitty\n' > ~/.config/kitty/kitty.conf; chmod 600 ~/.config/kitty/kitty.conf; bash /usr/share/omarchy/migrations/1788745941.sh; cat ~/.config/kitty/kitty.conf; stat -c %a ~/.config/kitty/kitty.conf` — the `yes` and `true` lines are now `# allow_remote_control …`, `socket-only` untouched, all other lines unchanged and in order, mode `600`, a new backup present.
  * Type `cp ~/.config/kitty/kitty.conf /tmp/kitty.after; bash /usr/share/omarchy/migrations/1788745941.sh; cmp /tmp/kitty.after ~/.config/kitty/kitty.conf && echo same` — no output from the migration and `same`. Then `printf 'allow_remote_control socket\nfont_size 13\n' > ~/.config/kitty/kitty.conf; bash /usr/share/omarchy/migrations/1788745941.sh; cat ~/.config/kitty/kitty.conf` — a restricted mode is preserved as-is.
  * Type `cp /tmp/kitty.orig ~/.config/kitty/kitty.conf; rm -f ~/.config/kitty/kitty.conf.bak.?????? /tmp/kitty.*; ls ~/.config/kitty/` — only `kitty.conf` (the post-update default) and the original `kitty.conf.bak.<digits>` remain. Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Kitty itself is not installed on this disk; only the config file matters — the migration edits the file regardless.
  * The migration rewrites a file only when its checksum matches the shipped 4.0.2 config or it contains an active `allow_remote_control yes`/`true`.
  * `bash /usr/share/omarchy/migrations/1788745941.sh` runs the script directly without touching the done marker; `omarchy-migrate` after `rm` of the marker is the wrapper path.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the directory listing/head/count after the update, the customised-file re-run with the four message lines (and whether the `Restart Kitty` box appeared), the grep showing the commented line with the preserved custom line, the fully custom file with only the `yes`/`true` lines commented, `socket-only` kept, mode `600` and a backup, the silent identical rerun with `same`, `socket` preserved, and the cleaned directory
  * If unsuccessful
  ** Screenshot of the old file untouched after the update, a missing backup, a lost or reordered custom line, `socket-only`/`socket` commented, the mode changed, output on the identical rerun, or an error under `Update Kitty configuration`
covers: migrations/1788745941.sh, bin/omarchy-refresh-config, config/kitty/kitty.conf (4.0.2 vs HEAD), bin/omarchy-migrate, test/shell.d/kitty-config-test.sh (migration half), manual/15-terminal.md
merged-from: 43:post-update-kitty-config-refreshed; 51:kitty-remote-control-repair

### post-update-mise-and-agent-wrappers   [VM-OK]
description: After the stable update the small user-state migrations have landed: mise no longer auto-prunes, the `hermes`, `cursor-agent` and `muse` commands plus the Hermes skill links exist in the user's home, and the wrapper installer refuses a name that is not usable as a command.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Precondition: the disk left by `update-menu-omarchy`. Open a terminal with Super+Enter and type `omarchy-version`.
  ** If it still prints `4.0.2-…` this test becomes SLOW: type `omarchy update -y`, type `prime` at sudo prompts, and answer No to the reboot question.
  * Type `mise settings get upgrade.auto_prune` — `false`.
  * Type `ls -l ~/.local/bin/hermes ~/.local/bin/cursor-agent ~/.local/bin/muse` — all three exist and are executable.
  * Type `head -4 ~/.local/bin/muse; head -1 ~/.local/bin/hermes`.
  ** `muse` starts with `#!/bin/bash`, `export MISE_MINIMUM_RELEASE_AGE=0`, `mise use -g --quiet "http:muse[…]"`; `hermes` starts with `# Written by omarchy-install-hermes-cli.`
  * Type `ls -l ~/.hermes/skills/` — symlinks `omarchy -> /usr/share/omarchy/default/agents/skills/omarchy` and `diagnose-crash -> …/diagnose-crash`.
  * Type `omarchy-mise-install 'x/y'; echo exit=$?` — `omarchy-mise-install: 'x/y' is not usable as a command name`, `exit=1`.
  * Close the terminal with Super+W; nothing was changed.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Do not run `muse`, `cursor-agent` or `hermes`: their first run downloads the tool and can take minutes.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of `false` from mise, the three wrappers, their first lines, the Hermes skill symlinks, and the rejected wrapper name
  * If unsuccessful
  ** Screenshot of a missing wrapper, `auto_prune` not `false`, or an error line under one of migrations 1787215483/1787760281/1787843905/1788577553/1788724825 in the update output
covers: migrations/1787215483.sh, 1787760281.sh, 1787843905.sh, 1788577553.sh, 1788724825.sh, bin/omarchy-mise-install, bin/omarchy-install-hermes-cli, test/shell.d/hermes-cli-migration-test.sh, hermes-skills-migration-test.sh
merged-from: 43:post-update-mise-and-agent-wrappers

### update-indicator-click-and-cancel   [VM-OK] [NET]
description: On the 4.0.2 disk the bar shows the circle-arrows update icon right of the clock and `omarchy-update-available` names only the newer Omarchy package; clicking the icon, `Update → Omarchy` and a typed `omarchy update` all open the same `Ready to update?` box, and backing out at the question changes nothing — version, pending migrations and the update lock are untouched and the icon stays. The entry to the blessed update path, without running it.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Screenshot the bar right of the clock: a circle-arrows icon is expected (allow up to a minute after login for the check). Open a terminal with Super+Enter and type `omarchy-version; omarchy-update-available; echo exit=$?`.
  ** `4.0.2-…`, then exactly one line like `omarchy 4.0.2-1 -> 4.0.4-1` and `exit=0` — no `linux`, `omarchy-settings` or other package lines.
  ** `Omarchy is up to date` with `exit=1` means the image already matches the mirror: record it, the icon is then correctly absent, skip the icon steps and continue with the menu and terminal paths.
  ** Icon absent while the command reports an update: type `omarchy-update-status` (or `omarchy-shell -q omarchy.system-update refresh`), wait five seconds, screenshot again; if still absent, report the mismatch.
  * Move the mouse over the icon: tooltip `Pending Omarchy Updates`. Click it with the left mouse button.
  ** A floating Omarchy terminal opens with the logo and the boxed `Ready to update?` text ("You cannot stop the update once you start!", the releases link) ending in `Continue with update?`. No password prompt and no snapshot text appear before the question.
  * Choose **No** (press `n`, or Right then Enter).
  ** `Update cancelled` then `● Done! Press any key to close...` — a cancel is not an error exit. Press a key; the terminal closes and the icon is still in the bar.
  ** If this build prints `● Failed (exit code 1)! Press any key to close...` instead, record it together with `omarchy-version` as build drift, not as a failure.
  * Open the Omarchy menu with Super+Space → `Update` → `Omarchy` with the mouse: the same box; choose No; the same closing line; press a key and the desktop is as before.
  * In your terminal type `omarchy update`: the same box inside the terminal; choose No → `Update cancelled`. Then type `pacman -Q omarchy; omarchy-migrate --pending; echo pending=$?; flock -n $XDG_RUNTIME_DIR/omarchy-update.lock true; echo lock-free=$?; ls -l /tmp/omarchy-update.log`.
  ** The version is unchanged, nothing is pending (`pending=1`), `lock-free=0` (no stale lock), and the log exists (the transcript starts before the question) — no packages were changed.
  * Close the terminal with Super+W; the desktop is as it started, icon included.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The gum box highlights Yes by default: make sure No is highlighted before pressing Enter, or press `n`. Never confirm the update in this test.
  * The bar's centre group is indicators, clock, (hidden keyboard-layout), weather, update icon; the icon is the small rotating-arrows glyph at the far right of that cluster. Double-check the mouse position with ./client-with-image before clicking it.
  * `checkupdates` needs the network; give the first command up to 30 seconds.
  * If a red free-space error appears instead of the box, report it: the 40 GB guest should pass the 10 GiB check.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the bar with the update icon, the terminal with the single `omarchy … -> …` line and `exit=0`, the tooltip, the `Ready to update?` box after the click with no sudo prompt before it, `Update cancelled` with the closing line, the same box from the menu and from the terminal, and the unchanged version / `pending=1` / `lock-free=0` / log listing with the icon still present
  ** For the absence path: the exact `Omarchy is up to date` line with `exit=1` and a bar without the icon
  * If unsuccessful
  ** Screenshot of the bar without the icon plus the `omarchy-update-available` output, extra package lines in that output, a sudo prompt or snapshot text before the question, or a changed version after a cancel; `tail -20 /tmp/omarchy-update.log` and `pgrep -a pacman`; `omarchy-version`
covers: bin/omarchy-update-available, bin/omarchy-update-status, bin/omarchy-update-confirm, bin/omarchy-update (cancel exits 0, lock acquisition), bin/omarchy-update-lock, bin/omarchy-launch-floating-terminal-with-presentation, bin/omarchy-show-done, shell/plugins/bar/widgets/SystemUpdate.qml (updateProc, runUpdate, tooltip), config/omarchy/shell.json (omarchy.system-update), default/omarchy/omarchy-menu.jsonc update.omarchy, manual/30-updates.md (Updates intro, circle arrow icon), manual/05-the-top-bar.md, docs/update-process.md (Path 1, State and coordination files, Shell update indicator), test/shell.d/update-available-test.sh, update-status-test.sh, version-test.sh
merged-from: 43:update-available-indicator; 12:update-available-indicator; 24:update-available-indicator-in-bar; 30:system-update-indicator; 52:update-available-and-status-indicator; 12:update-menu-cancel; 61:update-confirm-and-cancel

### update-refuses-overlapping-run-and-notifier-stays-quiet   [VM-OK]
description: Only one Omarchy update may run at a time: a second `omarchy update` while one is open (even one still at its question) is refused with `An Omarchy update is already running.` before it can snapshot, the migration notifier stays silent while that lock is held — the running update will run the migrations itself — and both the refusal and the silence lift as soon as the first update is cancelled.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy update`. Leave it at `Continue with update?` — do not answer.
  * Open a second terminal with Super+Enter (Hyprland tiles it next to the first) and type `omarchy update; echo exit=$?; ls -l $XDG_RUNTIME_DIR/omarchy-update.lock`.
  ** Expected: the single line `An Omarchy update is already running.` and `exit=1` — no box, no sudo prompt, no `Create system snapshot`; the lock file is listed.
  * In the second terminal type `rm ~/.local/state/omarchy/migrations/1786517850.sh; systemctl --user restart omarchy-migrate-notify.service`, wait ten seconds with screenshots: **no** `Pending Omarchy Migrations` toast (one harmless migration is pending, but the lock is held).
  * Click into the first terminal and answer **No** → `Update cancelled`.
  * In the second terminal type `systemctl --user restart omarchy-migrate-notify.service`.
  ** The toast `Pending Omarchy Migrations` / `Click to run 1 pending migration.` appears within a few seconds. Click it: a floating terminal runs `Running migration (1786517850)` and shows `● Done!`. Press a key.
  * In the second terminal type `omarchy update` again: the `Ready to update?` box appears now (lock released). Answer No. Then type `omarchy-migrate --pending; echo pending=$?; flock -n $XDG_RUNTIME_DIR/omarchy-update.lock true; echo lock-free=$?; sudo snapper list | tail -n 2` (password `prime`) — nothing pending, `pending=1`, `lock-free=0`, and no snapshot from the last minutes: nothing ran before the confirmation.
  * Close both terminals with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The lock is taken before the question, so the first update holds it without any answer. Hover or click a terminal before typing so the keys go to the right window.
  * An alternative way to hold the lock is `omarchy-update-lock run sleep 300 &` (or `flock "$XDG_RUNTIME_DIR/omarchy-update.lock" sleep 600 &`); `kill %1` releases it — if `kill %1` says no such job, `pkill -f 'sleep 300'`.
  * If the second run stops with `You need at least 10 GiB free...` instead, that is a different test; report it as such.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot showing both terminals: one at the confirm box, the other with `An Omarchy update is already running.` / `exit=1` and the lock file; no toast after the notifier restart while locked; the toast after the cancel; the migration running from the click; the box appearing in the second terminal afterwards with `pending=1`, `lock-free=0` and the snapper tail without a new row
  * If unsuccessful
  ** Screenshot of the second update reaching its own confirm box, a `Create system snapshot` line or a sudo prompt while the first is open, the re-run refused after the cancel, or a toast while the lock is held / no toast after release; `journalctl --user -u omarchy-migrate-notify.service -n 20 | sudo tee /dev/ttyS0` then `get-serial`; `omarchy-version`
covers: bin/omarchy-update-lock, bin/omarchy-update (lock acquisition), bin/omarchy-update-confirm, bin/omarchy-migrate-notify update_in_progress, docs/update-process.md "the notifier also refuses to run while omarchy update holds its lock", test/shell.d/update-lock-test.sh "prevents overlapping top-level updates", migrate-notify-test.sh "stays quiet while omarchy update holds its lock", manual/30-updates.md
merged-from: 43:update-rejects-overlapping-run; 52:update-refuses-while-another-update-runs; 43:migrate-notify-quiet-during-update; 24:update-cancel-and-lock-rejects-second-run

### update-refuses-low-disk-space   [VM-OK]
description: With less than 10 GiB free on `/` the update stops before asking anything — the helper and both the interactive and `-y` runs print `You need at least 10 GiB free to safely update Omarchy.` followed by the generic red banner, with no confirm box, no sudo prompt and no snapshot — `OMARCHY_UPDATE_FORCE=1` bypasses the check, and deleting the filler restores normal behaviour.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `df -h /`; note `Avail` (expected 25–35G).
  * Type `fallocate -l 25G ~/fill.img; df -h /`. `Avail` must now be below 10G; if not, type `fallocate -l 5G ~/fill2.img; df -h /` and check again.
  * Type `omarchy-update-requires-free-space; echo exit=$?` — `You need at least 10 GiB free to safely update Omarchy.`, `exit=1`.
  * Type `omarchy update; echo exit=$?`.
  ** The same line followed by the red `Something went wrong during the update!` banner and `exit=1`. No `Ready to update?` box, no sudo prompt, no `Create system snapshot`.
  * Type `omarchy update -y` — the same refusal, no snapshot line, non-zero exit.
  * Type `OMARCHY_UPDATE_FORCE=1 omarchy update`.
  ** The `Ready to update?` box appears despite the low space. Answer **No** → `Update cancelled`.
  * Type `rm -f ~/fill.img ~/fill2.img; df -h /; omarchy-update-requires-free-space; echo exit=$?` — the original free space is back and the helper is silent with `exit=0`.
  * Type `omarchy update` once more: the box appears; answer No. Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * `fallocate` on btrfs returns instantly; if it says "No space left", use a smaller size and add a second file (`dd if=/dev/zero of=~/fill.bin bs=1G count=22 status=progress` is the slow fallback).
  * The generic red banner after the refusal is expected: the free-space check is an ordinary failing step.
  * Always delete the filler before finishing, even on failure — other tests on this disk need the space.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of `df -h /` under 10G, the helper's refusal with `exit=1`, the refusal line plus banner with `exit=1` from `omarchy update` and from `-y` with no confirm box and no snapshot line, the forced run showing the confirm box, and the restored free space with the silent helper and the box appearing again
  * If unsuccessful
  ** Screenshot of the update reaching the confirm box or a `Create system snapshot` line with under 10G free, of the forced run still refusing, or of the filler failing to delete; `omarchy-version`
covers: bin/omarchy-update-requires-free-space, bin/omarchy-update (free-space step before confirm), docs/update-process.md "free-space requirement", test/shell.d/update-disk-space-test.sh, manual/30-updates.md
merged-from: 43:update-rejects-low-disk-space; 24:update-free-space-guard-stops-early; 52:update-refuses-low-disk-space

### update-keyring-passes-and-fails-cleanly   [VM-PARTIAL] [NET]
description: The keyring step reinstalls archlinux-keyring and prints `Keys are correct` only after a verifying check; with an unreachable mirror or a stale pacman `db.lck` the update stops at that step with pacman's error and the red banner instead of half-applying, `omarchy-migrate` on its own waits for the pacman lock rather than running against a half-installed package set, and with the bogus mirror the availability check quietly reads "up to date" — offline is indistinguishable from current, and a bogus mirrorlist is the only network failure a driver can produce from inside the guest.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy-update-keyring 2>&1 | tee /tmp/keyring.log; echo "exit=${PIPESTATUS[0]}"` (password `prime`).
  ** pacman reinstalls `archlinux-keyring` (~1 MB plus a database refresh; allow a minute) and the last line is `Keys are correct`, `exit=0`. Then `sudo pacman-key --list-keys | grep -i omarchy` — an Omarchy key is present.
  * Type `sudo cp /etc/pacman.d/mirrorlist /etc/pacman.d/mirrorlist.bak`, then `echo 'Server = http://127.0.0.1:1/$repo/os/$arch' | sudo tee /etc/pacman.d/mirrorlist`.
  * Type `omarchy-update-available; echo exit=$?` — `Omarchy is up to date`, `exit=1`, even though updates exist: record this as the known offline reading (the bar icon simply does not appear from it).
  * Type `omarchy update` and press Enter at `Continue with update?` (sudo `prime`). `Prune package cache` and `Create system snapshot` run; under `Update Arch signing keys` pacman prints errors like `failed retrieving file 'core.db' from 127.0.0.1` and `failed to synchronize all databases`, then the red `Something went wrong during the update!` block.
  ** `Update system packages` must not appear.
  * Type `sudo mv /etc/pacman.d/mirrorlist.bak /etc/pacman.d/mirrorlist; omarchy-update-available` — the pending `omarchy … -> …` line is back (or "up to date" on an already-updated disk).
  * Type `sudo touch /var/lib/pacman/db.lck; ls -l /var/lib/pacman/db.lck; omarchy update`, Enter at the question: `Prune package cache` and `Create system snapshot` run normally, then under `Update Arch signing keys` pacman prints `error: failed to init transaction (unable to lock database)` / `could not lock database: File exists` and the same red multi-line block; again no `Update system packages` and no `Running migration` line. `omarchy-version` — unchanged `4.0.2-…`.
  ** If the run instead stops at `Prune package cache`, report it — that step is not expected to need the pacman lock. The failure comes right after the snapshot, so the run is under a minute.
  * With the lock still in place type `rm -f ~/.local/state/omarchy/migrations/1786517850.sh; omarchy-migrate` — `Waiting for pacman transaction to finish before running Omarchy migrations...` is printed and the command keeps waiting: no `Running migration` line, the prompt does not return (screenshot after ten seconds). Open a second terminal with Super+Enter and type `sudo rm /var/lib/pacman/db.lck; ls /var/lib/pacman/db.lck` — `No such file or directory`. Click back into the first terminal: within a couple of seconds it prints `Running migration (1786517850)` / `Drop the retired notification image cache` and returns. Then `omarchy-migrate --pending; echo pending=$?` — nothing listed, `pending=1`.
  ** The waiter polls once a second for up to 15 minutes; remove the lock after your screenshot, do not wait it out. Migration 1786517850 only deletes an empty cache directory; it is safe to re-run.
  * Type `omarchy update` once more: the `Ready to update?` box appears; answer No (back to normal). Close both terminals with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Skipped part: a real link-down, DNS failure and the bar widget with no route at all cannot be produced from inside the guest.
  * The Omarchy repo is in /etc/pacman.conf and still syncs; the failure comes from core/extra.
  * Do not leave the bogus mirrorlist or the `db.lck` in place: every later pacman step on this disk depends on them being restored.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the `archlinux-keyring` reinstall followed by `Keys are correct` and `exit=0`, the Omarchy key, the replaced mirrorlist, `Omarchy is up to date`, the retrieval errors under the keyring banner with the red block, the restored check, the lock file listing and the `unable to lock database` error with the red block and unchanged `omarchy-version`, the `Waiting for pacman transaction…` line with nothing running while the lock exists, `Running migration (1786517850)` after its removal with `pending=1` and the lock gone, and the box appearing again after cleanup
  * If unsuccessful
  ** `Keys are correct` printed after an earlier error, the update continuing to `Update system packages` with the bogus mirror or the lock, no red block, the update hanging, the migration running while the lock file exists, the command not resuming after the lock is removed, or the lock not removable; `tail -n 60 /tmp/omarchy-update.log | sudo tee /dev/ttyS0` via `get-serial`; `omarchy-version`
covers: bin/omarchy-update (ERR trap), bin/omarchy-update-keyring, bin/omarchy-update-system-pkgs, bin/omarchy-update-available, bin/omarchy-migrate wait_for_pacman_transaction, migrations/1786517850.sh, agents/skills/migrations.md "waits for any active pacman transaction", docs/update-process.md (Path 1), test/shell.d/update-keyring-test.sh, manual/30-updates.md
merged-from: 24:update-bogus-mirror-fails-with-banner; 52:update-keyring-reports-keys-correct; 43:update-rejects-pacman-lock; 43:migrate-waits-for-pacman-lock

### update-heals-unowned-file-conflict   [VM-OK] [NET] [SLOW]
description: When a file the new `omarchy` package installs already exists unowned on disk, the update does not die on pacman's `exists in filesystem` error — it moves the file to /var/lib/omarchy/replaced, retries once, and completes.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `sudo touch /usr/bin/omarchy-install-hermes-cli; pacman -Qo /usr/bin/omarchy-install-hermes-cli` (password `prime`) — expect `error: No package owns /usr/bin/omarchy-install-hermes-cli`.
  * Type `omarchy update`, answer Yes, type `prime` at sudo prompts.
  ** Under `Update system packages` pacman fails with `error: failed to commit transaction (conflicting files)` and `omarchy: /usr/bin/omarchy-install-hermes-cli exists in filesystem`.
  ** Right after, a yellow `Taking over files pacman doesn't own yet:` heading with `  /usr/bin/omarchy-install-hermes-cli -> /var/lib/omarchy/replaced/usr/bin/omarchy-install-hermes-cli`, then a second `Update system packages` heading and a successful pacman run, then the migrations.
  * Answer No to any orphan question and No to the reboot question.
  * Type `ls -l /var/lib/omarchy/replaced/usr/bin/; pacman -Qo /usr/bin/omarchy-install-hermes-cli; omarchy-version`.
  ** The quarantined empty file is listed, the live path is owned by `omarchy`, the version is the new one.
  * This leaves the disk updated but not rebooted: end with `stop` (or reboot via Super+Escape → Reboot before reusing it).
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Screenshot as soon as the pacman error appears; the yellow handler text follows within seconds. The whole run is a full update (> 5 min); screenshot repeatedly instead of sleeping.
  * The path must be outside /usr/share/omarchy (that tree is overwritten unconditionally) and new in the target release. If `pacman -Qo` already reports the path as owned, note it and use `/usr/bin/omarchy-update-pacman` (new in HEAD) on an edge disk instead.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the unowned check, the pacman conflict error, the yellow `Taking over files…` block with the `->` line, the second successful `Update system packages`, and the final `ls`/`pacman -Qo`/`omarchy-version` output
  * If unsuccessful
  ** Screenshot of the update stopping with `Something went wrong` after the conflict, or of `Putting back what the upgrade didn't take:`; `sudo cat /tmp/omarchy-update.log | sudo tee /dev/ttyS0` then `get-serial`
covers: bin/omarchy-update-system-pkgs, bin/omarchy-update-system-pkgs-when-conflicted, docs/update-process.md conflict handler, test/shell.d/update-file-conflict-test.sh
merged-from: 43:update-heals-unowned-file-conflict

### update-stops-on-failed-migration   [VM-OK] [NET] [SLOW]
description: A migration that fails stops the queue, stays pending, and ends `omarchy update` with the red `Something went wrong` banner — no later migration, no mise step, no shell restart, no reboot question; after the cause is fixed a plain `omarchy-migrate` resumes from that migration and finishes the rest.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `chmod 555 ~/.config/mise; ls -ld ~/.config/mise` — the directory shows `dr-xr-xr-x`.
  * Type `omarchy update`, answer Yes, type `prime` at sudo prompts, and wait through the package upgrade.
  ** The first migration is `Running migration (1787215483)` / `Stop mise upgrades from pruning versions still in use`; `mise settings set` fails with a permission/read-only error; **no** further `Running migration` line; the red `Something went wrong during the update!` banner is printed and the prompt returns. No `Update mise tools`, no reboot question, no `Restarting shell`.
  * Type `omarchy-migrate --pending | sudo tee /dev/ttyS0` — the list starts with `1787215483.sh` and includes the others (`1788745941.sh`, `1789325478.sh`, …).
  * Type `chmod 755 ~/.config/mise; ls -ld ~/.config/mise` — back to `drwxr-xr-x`.
  * Type `omarchy-migrate` (type `prime` at sudo prompts).
  ** `Running migration (1787215483)` runs again, then every remaining migration in order (the `Restart Kitty` box, the kernel install…) with no error.
  * Type `omarchy-migrate --pending; echo pending=$?; omarchy-version` — nothing pending, `pending=1`, the new version.
  * This leaves the disk updated but not rebooted: end with `stop` (or reboot via Super+Escape → Reboot before reusing it).
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If `mise settings set` unexpectedly succeeds with the read-only directory, report it; the fallback is to break the edge-only `vi` migration on an edge disk with `sudo touch /usr/bin/vi` before the update.
  * The bar is not restarted after a failed update, so the update icon stays until the manual `omarchy-migrate` and a later `omarchy update`.
  * A full update precedes the failure (> 5 min); screenshot repeatedly instead of sleeping.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the read-only directory, the failing migration output followed directly by the red banner, the serial log listing `1787215483.sh` first, the restored permissions, the manual `omarchy-migrate` running the remaining migrations, and `pending=1` with the new version
  * If unsuccessful
  ** Screenshot showing a later migration running after the failed one, the failed migration missing from `--pending`, or `Restarting shell` after the failure; `sudo cat /tmp/omarchy-update.log | sudo tee /dev/ttyS0` then `get-serial`
covers: bin/omarchy-migrate (set -e, marker only on success), bin/omarchy-update (ERR trap, ordering), agents/skills/migrations.md "strictly ordered and synchronous", migrations/1787215483.sh, test/shell.d/migrate-scope-test.sh "does not mark failed migrations complete", update-sequence-test.sh
merged-from: 43:update-stops-on-failed-migration

### update-orphan-pkgs-defaults-to-keeping   [VM-OK]
description: The post-update orphan review lists orphaned packages, only offers removal on a terminal, and defaults to keeping them, so an unattended update never uninstalls anything.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy-update-orphan-pkgs; echo "exit=$?"` — on a fresh install expect no output and `exit=0`.
  * Create one orphan without installing anything: mark an installed leaf package as a dependency, `sudo pacman -D --asdeps btop` (password `prime`). Confirm `pacman -Qtdq` now prints `btop`.
  * Type `omarchy-update-orphan-pkgs | cat` (piped, so it is non-interactive).
  ** Expect the heading `Orphan system packages`, the line `  btop`, and `1 orphaned package(s) found. Re-run omarchy-update-orphan-pkgs in a terminal to review/remove them.` — and no removal.
  * Type `omarchy-update-orphan-pkgs` directly. Expect the prompt `Remove 1 orphaned package(s)?` with **No** preselected. Press Enter.
  ** Expect `Keeping orphaned packages.` and `pacman -Q btop` still succeeding.
  * Restore the package's status: `sudo pacman -D --asexplicit btop` and confirm `pacman -Qtdq` prints nothing again. Close the terminal with Super+W.
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
  ** Screenshot of the confirm prompt with No preselected and the resulting `Keeping orphaned packages.`; `pacman -Q btop` still present; `pacman -Qtdq` empty after restoring
  * If unsuccessful
  ** Screenshot of a `Removing orphan system packages` line or a `pacman -Rns` transaction that ran without an explicit Yes; `omarchy-version`
covers: bin/omarchy-update-orphan-pkgs, test/shell.d/update-orphan-test.sh, manual/30-updates.md
merged-from: 52:update-orphan-pkgs-defaults-to-keeping

### pacman-direct-upgrade-guard   [VM-OK] [NET]
description: A direct `pacman -Syu` is stopped by Omarchy's alpm pre-transaction hook (`00-omarchy-update-guard.hook`, AbortOnFail) with the "Woah partner..." message pointing to `omarchy update` and the `OMARCHY_ALLOW_DIRECT_PACMAN=1` override, so users cannot bypass the snapshot/keyring/migration sequence by accident; a wrong sudo password is refused first, and a plain database sync, a single-package install and the documented override go through. The hook is reached with one-package transactions so no upgrade set is downloaded.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `ls /usr/share/libalpm/hooks/ | grep omarchy; cat /usr/share/libalpm/hooks/00-omarchy-update-guard.hook; omarchy-version; pacman -Q omarchy` — the three `*-omarchy-*.hook` files (update-guard, hyprland-reload-pause, hyprland-reload-resume), the hook naming `omarchy-update-pacman-guard` with `AbortOnFail`, and the build.
  * Type `OMARCHY_PACMAN_CMDLINE="pacman -Syu" omarchy-update-pacman-guard; echo rc=$?` — the `Woah partner...` message ("This looks like a direct pacman system upgrade") ending with `sudo env OMARCHY_ALLOW_DIRECT_PACMAN=1 pacman -Syu`, then `rc=1`. Then `OMARCHY_PACMAN_CMDLINE="pacman -S cowsay" omarchy-update-pacman-guard; echo rc=$?` — silent, `rc=0`; `OMARCHY_ALLOW_DIRECT_PACMAN=1 OMARCHY_PACMAN_CMDLINE="pacman -Syu" omarchy-update-pacman-guard; echo rc=$?` — silent, `rc=0`; and `omarchy update pacman guard --help` — the hidden guard still answers help.
  * Type `sudo pacman -Sy; echo exit=$?` and at `[sudo] password for prime:` first type `wrong` — `Sorry, try again.` and a second prompt; then `prime` — databases sync with the candy progress bar, `exit=0`, no guard message (a sync without `-u` is not guarded). Then `pacman -Qu | head -3; pacman -Q | wc -l; pacman -Q bash` — the pending upgrades, and note the count and version.
  * Type `sudo pacman -Syu --ignore '*' bash 2>&1 | tail -20; echo status=${PIPESTATUS[0]}` — the real command line reaching the real hook with one package.
  ** pacman asks `bash is in IgnorePkg/IgnoreGroup. Install anyway? [Y/n]` — type `y`; then `:: Proceed with installation? [Y/n]` — type `Y`. After a small download (~2 MB): `:: Running pre-transaction hooks...` / `Checking Omarchy update entrypoint...`, then the `Woah partner...` block naming `omarchy update` and `sudo env OMARCHY_ALLOW_DIRECT_PACMAN=1 pacman -Syu`, and pacman ends with `error: failed to commit transaction (failed to run transaction hooks)`; `status` non-zero. After the abort the transaction is over — answer nothing further.
  ** The same block appears for the long form `--sync --refresh --sysupgrade --ignore '*' bash` and for `sudo env OMARCHY_PACMAN_CMDLINE='pacman -Syu' pacman -S --noconfirm bash` (the hook reads the faked command line — same code path). The hook fires inside the transaction, after the download — so never run a bare `sudo pacman -Syu`: it would download every pending upgrade first. If pacman rejects the `*` glob, use the `OMARCHY_PACMAN_CMDLINE` form instead.
  * Type `sudo env OMARCHY_ALLOW_DIRECT_PACMAN=1 pacman -Syu --ignore '*' bash 2>&1 | tail -5; echo status=${PIPESTATUS[0]}`, answering `y`/`Y` to the same questions — `Checking Omarchy update entrypoint...` passes silently, bash is reinstalled, no `Woah partner`, `status=0`.
  * Type `sudo pacman -S --needed bash` — a plain install (no `-u`) is not blocked either (`is up to date -- skipping` or a reinstall). Then `pacman -Q | wc -l; pacman -Q bash; pacman -Q omarchy; omarchy version` — the same count, bash version and omarchy version as before; nothing else changed.
  * Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The message is long and on stderr just before pacman's own error; if it scrolls, rerun with `2>&1 | sudo tee /dev/ttyS0` and read `./client get-serial`. Screenshot as soon as the hooks start.
  * A mirror error before the hook is an environment problem, not a failure. If pacman says `there is nothing to do` for the sysupgrade, the mirror has no upgrades for this image: record it — the `--ignore '*' bash` target still produces a transaction. A missing guard on the 4.0.2 build may be build drift — the `omarchy-version` line tells the two apart.
  * Do not run `omarchy update` here (own tests) and do not confirm any real upgrade set. The database sync can take a minute on the VM's NAT; keep screenshotting rather than retyping.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The three hook files with the AbortOnFail hook text and the build; the guard script's `Woah partner` with `rc=1`, two silent `rc=0` runs and the `--help`; `Sorry, try again.` then the plain sync with `exit=0` and no message; the real `--ignore '*' bash` transaction aborted by the hook with `:: Running pre-transaction hooks...`, `Woah partner...`, `omarchy update`, the `OMARCHY_ALLOW_DIRECT_PACMAN=1` line, `error: failed to commit transaction (failed to run transaction hooks)` and a non-zero status; the bypass run completing with `status=0` and no block; the plain `-S --needed bash` unblocked; unchanged package count, bash and omarchy versions
  * If unsuccessful
  ** Screenshot of the transaction going through without the message (packages actually upgrading), the bypass still blocked, the guard blocking a single install, or a missing hook; the guard script's output for the mismatching case; `tail -30 /var/log/pacman.log`; `omarchy-version`
covers: default/libalpm/hooks/00-omarchy-update-guard.hook, default/libalpm/hooks/10-omarchy-hyprland-reload-pause.hook, default/libalpm/hooks/90-omarchy-hyprland-reload-resume.hook, bin/omarchy-update-pacman-guard, bin/omarchy-update-pacman, default/pacman/*.conf, test/shell.d/config-test.sh (alpm hooks installed), update-pacman-guard-test.sh, update-pacman-test.sh, docs/update-process.md (Raw pacman guard, Path 2), manual/30-updates.md (Warning about direct pacman/yay updates)
merged-from: 51:pacman-direct-upgrade-guard; 23:pacman-direct-upgrade-guard; 41:pacman-direct-upgrade-guard; 52:pacman-direct-upgrade-guard; 12:update-pacman-guard-blocks-direct-syu; 24:update-pacman-guard-blocks-direct-syu; 43:pacman-guard-blocks-direct-sysupgrade; 61:update-pacman-guard-blocks-sysupgrade

### migrate-idempotent-and-login-notifier   [VM-OK]
description: `omarchy-migrate` is safe to run any number of times — silent when nothing is pending, runs exactly the un-marked migration once, silent again — the login notifier turns pending migrations into a clickable critical `Pending Omarchy Migrations` toast (counting them: `1 pending migration` / `2 pending migrations`) that runs them in a floating terminal and restores the markers, the toast goes away on its own when they are run by hand, a real logout/login shows it only when something is pending, and bad options (`--bogus`, the retired `--force`) are refused with the usage line — the safety net for users who bypass `omarchy update`.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `ls ~/.local/state/omarchy/migrations | wc -l; ls /usr/share/omarchy/migrations | wc -l; omarchy-migrate --pending; echo pending=$?` — two equal counts (`96` on a stock 4.0.2 disk), no list, `pending=1`.
  ** If names print with `exit=0`, the disk has pending migrations (HEAD/4.0.2 skew): record them and continue.
  * Type `omarchy-migrate; echo exit=$?; omarchy-migrate-notify; echo exit=$?; systemctl --user restart omarchy-migrate-notify.service; systemctl --user status omarchy-migrate-notify.service --no-pager | head -n 4` — no `Running migration` line and `exit=0`; no toast and `exit=0`; **no** toast within five seconds of the restart either (nothing pending); the unit exists and is `inactive (dead)` after its run.
  * Type `rm ~/.local/state/omarchy/migrations/1786517850.sh; omarchy-migrate --pending; echo pending=$?` — `1786517850.sh`, `pending=0`.
  * Type `systemctl --user restart omarchy-migrate-notify.service` (the login notifier, fired without a relogin): within a few seconds a critical toast `Pending Omarchy Migrations` / `Click to run 1 pending migration.` appears at the top right — screenshot at once.
  * Click the toast with the mouse. A floating terminal shows the green logo, green `Running migration (1786517850)`, `Drop the retired notification image cache`, then `● Done! Press any key to close...`; press a key; the toast is gone.
  ** If the toast already faded, `omarchy-migrate-notify` re-sends it; if clicking does nothing, type `omarchy-migrate; echo exit=$?` (same two lines, `exit=0`) and report the click failure. Stderr text `Omarchy has pending migrations` means no notification server answered — report it.
  * Type `omarchy-migrate; echo exit=$?; omarchy-migrate --pending; echo pending=$?; ls ~/.local/state/omarchy/migrations/1786517850.sh` — no `Running migration` line, `exit=0`, `pending=1`, the marker is back (nothing runs twice).
  * Type `rm ~/.local/state/omarchy/migrations/1786517850.sh ~/.local/state/omarchy/migrations/1785511354.sh; systemctl --user restart omarchy-migrate-notify.service` — the toast now says `Click to run 2 pending migrations.`; do **not** click it. Type `omarchy-migrate` (type `prime` if sudo asks): both migrations run (1785511354 only checks that qrencode is installed) and the toast disappears on its own.
  * Type `omarchy-migrate --bogus; echo exit=$?; omarchy-migrate --force; echo exit=$?; omarchy-migrate --help` — `Unknown option: --bogus`, `exit=1`, `Unknown option: --force`, a non-zero exit, then `Usage: omarchy-migrate [--pending]`. Then `rm ~/.local/state/omarchy/migrations/1786517850.sh` (one pending again) and close the terminal with Super+W.
  * Real login path: press Super+Escape → click `Logout` with the mouse → at the login screen log in as `prime` / `prime` (autologin does not re-fire after a logout; no LUKS passphrase — the disk stays unlocked). Within ~15 seconds of the desktop the `Click to run 1 pending migration.` toast appears; click it → the migration runs, `Done!`, press a key. Log out and in the same way once more: with nothing pending, **no** migration toast may appear in 15 seconds of screenshots. Open a terminal and type `omarchy-migrate --pending; echo pending=$?` — empty, `pending=1`; close it with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Only un-mark 1786517850 and 1785511354; other migrations may need sudo or network, or change groups and the kernel. `omarchy migrate` (the router spelling) reaches the same script.
  * `omarchy-migrate` waits up to 15 min if pacman is running; `Waiting for pacman transaction…` means another process is updating — report it.
  * The toast is critical-urgency and stays a little longer than normal ones, but click it within a few seconds; double-check the mouse position before clicking. The notifier waits for the notification server; allow up to ten seconds for the toast after a restart, ~15 s after a login.
  * The greeter has no username field or session chooser — just the dotted entry; a wrong password shows a red lock, cleared by the next keystroke.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the equal counts with `pending=1`, the silent run and quiet notifier (no toast after the restart with nothing pending) with the unit status, the pending listing, the toast after the service restart, the floating terminal with `Running migration (1786517850)` and its description, the silent re-run with `pending=1` and the marker restored, the `2 pending migrations` toast and the desktop with it gone after the manual `omarchy-migrate`, the `Unknown option` / usage lines, the toast ~15 s after the re-login with a pending marker and the terminal it opens, and the clean re-login with no toast plus the empty `--pending`
  * If unsuccessful
  ** Screenshot of output or a non-zero exit on the silent runs, a toast with nothing pending, no toast after the restart or the re-login (`journalctl --user -u omarchy-migrate-notify -n 30 | sudo tee /dev/ttyS0`), a click that opens nothing, the migration running twice, or the marker missing after a successful run; `omarchy-version`
covers: bin/omarchy-migrate (--pending, run, option parsing, marker, notification dismiss), bin/omarchy-migrate-notify, bin/omarchy-update-user-notify, default/systemd/user/omarchy-migrate-notify.service, bin/omarchy-launch-floating-terminal-with-presentation, migrations/1786517850.sh, migrations/1785511354.sh, agents/skills/migrations.md ("Manually", "Testing migrations", "At login", model, --pending exit codes), docs/update-process.md (§Migration layout, §Path 2, §Fallbacks), docs/notifications.md §Pending migrations, test/shell.d/migrate-wrapper-test.sh, migrate-notify-test.sh, migrate-scope-test.sh, manual/30-updates.md
merged-from: 43:migrate-rerun-is-idempotent; 20:migrate-nothing-pending; 20:migrate-fake-pending-notify-and-run; 24:migrate-notification-runs-pending-migration; 52:migrate-pending-notifier-and-runner; 61:migrate-pending-and-rerun; 43:migrate-notify-login-toast; 61:migrate-notify-toast-and-relogin

### migrations-hand-rerun-small-scripts   [VM-OK]
description: Re-running Omarchy's small migrations by hand is safe: an unparsable shell.json is left untouched by the agents rename, an identical stock user font is retired while a modified one is kept, Hermes skills are linked without creating profiles, and the Hermes skin migration is a no-op without the app — the scripts `omarchy migrate` runs on update, each asserted idempotent.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `cp ~/.config/omarchy/shell.json /tmp/shell.json.orig; printf '{ not json' > ~/.config/omarchy/shell.json; bash /usr/share/omarchy/migrations/1786099804.sh; cat ~/.config/omarchy/shell.json; cp /tmp/shell.json.orig ~/.config/omarchy/shell.json` — still exactly `{ not json`, then restored.
  ** If `~/.config/omarchy/shell.json` does not exist on this disk, the first `cp` fails: skip this step and say so (the bar then runs on the shipped file).
  * Type `mkdir -p ~/.local/share/fonts; cp /usr/share/fonts/omarchy/omarchy.ttf ~/.local/share/fonts/omarchy.ttf; bash /usr/share/omarchy/migrations/1788848726.sh; ls ~/.local/share/fonts/omarchy.ttf 2>&1` — the identical stock copy was removed (`No such file or directory`).
  * Type `cp /usr/share/fonts/omarchy/omarchy.ttf ~/.local/share/fonts/omarchy.ttf; echo custom >> ~/.local/share/fonts/omarchy.ttf; bash /usr/share/omarchy/migrations/1788848726.sh; ls ~/.local/share/fonts/omarchy.ttf; rm ~/.local/share/fonts/omarchy.ttf` — the modified font was kept, then removed by hand.
  * Type `bash /usr/share/omarchy/migrations/1787843905.sh; ls -l ~/.hermes/skills/; ls ~/.hermes/profiles 2>&1` — symlinks `omarchy` and `diagnose-crash` → `/usr/share/omarchy/default/agents/skills/…`, and no `profiles` directory.
  * Type `bash /usr/share/omarchy/migrations/1788619462.sh; echo s=$?; rm /tmp/shell.json.orig` — `s=0` and nothing happens (no Hermes Desktop).
  * Close the terminal with Super+W; the bar is unchanged.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * `~/.hermes/skills` may already hold the links from provisioning; the migration must then leave them as they are.
  * `shell.json` is replace-not-merge: restore it exactly from the copy, never hand-edit it here.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** `{ not json` intact and the file restored; stock font removed, modified font kept; skill links with no profiles; skin migration no-op with `s=0`
  * If unsuccessful
  ** A truncated shell.json, a deleted custom font, or profiles created; the failing script's output
covers: test/shell.d/agents-rename-migration-test.sh (unparsable config), legacy-icon-font-migration-test.sh, hermes-skills-migration-test.sh, hermes-skin-migration-test.sh; migrations/1786099804.sh, 1788848726.sh, 1787843905.sh, 1788619462.sh
merged-from: 51:migrations-rerun-safely

### migration-legacy-udev-rules-quarantine   [VM-OK]
description: The migration for Omarchy 3's root-runs-user-home udev rules removes the exact generated files and reloads udev, quarantines any modified variant to `.omarchy-disabled` instead of deleting an admin's additions, keeps unrelated same-named rules byte-for-byte, and is a no-op on rerun.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `M=/usr/share/omarchy/migrations/1788102906.sh; R=/etc/udev/rules.d; sudo -v` (password `prime`), then `printf '%s\n' 'SUBSYSTEM=="power_supply", ATTR{type}=="Mains", ATTR{online}=="0", RUN+="/home/someuser/.local/share/omarchy/bin/omarchy-wifi-powersave on"' 'SUBSYSTEM=="power_supply", ATTR{type}=="Mains", ATTR{online}=="1", RUN+="/home/someuser/.local/share/omarchy/bin/omarchy-wifi-powersave off"' | sudo tee $R/99-wifi-powersave.rules >/dev/null`.
  * Type `bash $M; echo s=$?; ls $R/99-wifi-powersave.rules* 2>&1` — `s=0` and the file is gone with no quarantine copy.
  * Type `printf '%s\n' 'SUBSYSTEM=="power_supply", ATTR{type}=="Mains", RUN+="/usr/bin/systemd-run --no-block --collect --unit=omarchy-power-profile --property=After=power-profiles-daemon.service /home/someuser/.local/share/omarchy/bin/omarchy-powerprofiles-set"' 'ACTION=="add", SUBSYSTEM=="usb", RUN+="/usr/local/sbin/admin-power-hook"' | sudo tee $R/99-power-profile.rules >/dev/null`.
  * Type `bash $M; echo s=$?; ls $R/99-power-profile.rules*; sudo cat $R/99-power-profile.rules.omarchy-disabled` — `s=0`, a `Quarantined … .omarchy-disabled` line, the `.rules` gone, the `.omarchy-disabled` file holding both original lines.
  * Type `printf '%s\n' '# Replaces the rule Omarchy used to install from /home/someuser/.local/share/omarchy/bin/omarchy-powerprofiles-set' 'SUBSYSTEM=="power_supply", ATTR{type}=="Mains", RUN+="/usr/local/bin/my-own-power-hook"' | sudo tee $R/99-power-profile.rules >/dev/null; sudo sha256sum $R/99-power-profile.rules; bash $M; echo s=$?; sudo sha256sum $R/99-power-profile.rules` — identical hashes (kept), `s=0`.
  * Type `bash $M; echo s=$?` — `s=0` with no output (no-op).
  * Type `sudo rm -f $R/99-power-profile.rules $R/99-power-profile.rules.omarchy-disabled; sudo udevadm control --reload` — the rules directory is as it started. Close the terminal with Super+W.
  ** The migration itself runs `sudo /usr/bin/rm`, `mv --no-clobber` and `udevadm control --reload`; the cached credential satisfies them.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Type each `printf … | sudo tee` line as one command; the quoting must reach the file exactly.
  * The lines are long; `| sudo tee /dev/ttyS0` and `get-serial` are handy for reading the quarantined file back.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Exact rule removed; modified rule quarantined with the message and both lines preserved; harmless rule hash unchanged; silent rerun; clean directory
  * If unsuccessful
  ** The exact rule surviving, the admin line deleted instead of quarantined, or the harmless rule altered; the script's output
covers: test/shell.d/legacy-power-udev-rules-migration-test.sh (udev half); migrations/1788102906.sh; manual/48-security.md
merged-from: 51:legacy-udev-rule-migration-quarantine

### migration-security-groups-flag-reboot   [VM-OK]
description: Two migrations drop blanket `input` and `docker` group grants from the login user only when present, flag a reboot (indicator in the bar) instead of rebooting, refresh the Docker launcher, and do nothing when the user is not a member.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy state clear reboot-required; id -nG` — note the groups (`prime` is not in `input` or `docker` on a stock disk).
  ** If `omarchy state` is an unknown command on this build, use `rm -f ~/.local/state/omarchy/reboot-required` wherever `clear` appears and note "absent on this build".
  * Type `sudo gpasswd -a prime input; bash /usr/share/omarchy/migrations/1787865477.sh; getent group input; ls ~/.local/state/omarchy/reboot-required` (password `prime`) — `prime` no longer in `input`, the flag exists and the bar shows the reboot indicator; screenshot.
  * Type `omarchy state clear reboot-required; bash /usr/share/omarchy/migrations/1787865477.sh; ls ~/.local/state/omarchy/reboot-required 2>&1` — not a member → no flag (idempotent).
  * Type `sudo gpasswd -a prime docker; bash /usr/share/omarchy/migrations/1787580187.sh; getent group docker; ls ~/.local/state/omarchy/reboot-required; cmp ~/.local/share/applications/Docker.desktop /usr/share/omarchy/applications/Docker.desktop && echo launcher-refreshed` — `prime` removed, flag set, `launcher-refreshed`.
  * Type `omarchy state clear reboot-required` — the indicator disappears; the machine did not reboot. Close the terminal with Super+W.
  ** Group changes apply at next login; the migrations must never reboot on their own.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If `prime` was already in `input` at the start, the first migration run is the real repair; note it.
  * The reboot indicator is a small glyph in the bar's indicator cluster; screenshot the bar before and after clearing the flag.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Membership removed and the indicator shown for both groups; no flag when not a member; `launcher-refreshed`; the indicator gone after clearing; no reboot
  * If unsuccessful
  ** Membership kept, a flag with nothing changed, or a reboot triggered; the script's output
covers: test/shell.d/input-group-migration-test.sh, docker-group-migration-test.sh; migrations/1787865477.sh; migrations/1787580187.sh; bin/omarchy-state; manual/18-development-tools.md
merged-from: 51:security-group-migrations

### migration-copy-url-defers-while-chromium-open   [VM-OK]
description: The Copy URL shortcut repair rewrites Chromium's Preferences to the pinned extension id only while Chromium is closed (it would revert the file on exit), asks before proceeding, backs the file up, is idempotent, and leaves third-party `copy-url` commands alone.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Close Chromium if open (Super+W). Open a terminal with Super+Enter and type `P=~/.config/chromium/Default/Preferences; cp "$P" /tmp/prefs.orig; jq '.extensions.commands["linux:Alt+Shift+L"]={command_name:"copy-url",extension:"ikkebdkaanlebnifjnbeiaklodhbjcci",global:false} | .extensions.settings["ikkebdkaanlebnifjnbeiaklodhbjcci"]={commands:{"copy-url":{suggested_key:"Alt+Shift+L",was_assigned:true}}}' /tmp/prefs.orig > "$P"`.
  ** If `Preferences` does not exist, open Chromium once (Super+Shift+B, or `setsid chromium >/dev/null 2>&1 &` from the terminal), wait for the window, close it with Super+W, and retry. Chromium on 2 vCPU may raise Hyprland's "not responding" dialog: click Wait.
  * Open Chromium (Super+Shift+B or the terminal command above); back in the terminal type `bash /usr/share/omarchy/migrations/1786643346.sh; echo s=$?` — a gum yes/no asks to close the browser; answer No (`n`) — non-zero `s`, and `jq -r '.extensions.commands["linux:Alt+Shift+L"].extension' "$P"` still shows the ghost id.
  * Close Chromium (Super+W, wait 3 s) and run the migration again — `s=0`; the `jq` now prints `bgpiichlckmfanooecilcjemknkcpngb`; `ls "$P.omarchy-copy-url-repair.bak"` exists.
  * Type `sha256sum "$P"; bash /usr/share/omarchy/migrations/1786643346.sh; sha256sum "$P"` — identical (idempotent).
  * Type `jq '.extensions.commands["linux:Ctrl+Alt+P"]={command_name:"copy-url",extension:"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",global:false} | .extensions.settings["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]={path:"/home/prime/ext",commands:{}}' "$P" > /tmp/p && mv /tmp/p "$P"; sha256sum "$P"; bash /usr/share/omarchy/migrations/1786643346.sh; sha256sum "$P"` — identical (third-party binding left alone).
  * Type `cp /tmp/prefs.orig "$P"; rm -f "$P".omarchy-copy-url-repair.bak /tmp/prefs.orig` — Chromium's preferences are as they were. Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The prompt is a gum yes/no in the terminal; `n` declines.
  * Hover the terminal before typing while Chromium is open so the keys go to the right window.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Deferral with the browser open; repair to the pinned id with a backup once closed; identical hashes on rerun and with a third-party binding; the restored preferences
  * If unsuccessful
  ** The file rewritten while Chromium ran, the ghost surviving a clean run, or the third-party entry changed; the script's output
covers: test/shell.d/copy-url-shortcut-migration-test.sh; migrations/1786643346.sh; manual/23-browsers.md
merged-from: 51:copy-url-migration-defers-while-chromium-open

### channel-current-menu-check-and-refusals   [VM-OK]
description: `omarchy channel current` reports the installed channel and Update → Channel marks it with the only ✓; `omarchy-channel-set` refuses a missing or unknown channel with its usage line, `omarchy-refresh-pacman` refuses an unknown channel before touching pacman, the dev-channel warning declined from the terminal or the menu prints `Cancelled.` and changes nothing, and a `~/omarchy` that is not a git checkout makes the dev switch refuse before any package changes — the only channel paths cheap enough to run on every disk.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy channel current; omarchy-version-channel; sha256sum /etc/pacman.conf /etc/pacman.d/mirrorlist; grep -c omarchy.org /etc/pacman.d/mirrorlist` — `stable`, `stable`, note the two hashes and the count.
  ** If `omarchy-channel-current` is "command not found" or the menu has no Channel row, the disk predates channels (4.0.2 skew): record it, judge by what exists, and skip the missing parts.
  * Open the Omarchy menu with Super+Space → `Update` → `Channel`. Four rows: Stable 🟢, RC 🟡, Edge 🟠, Dev 🔴; only Stable carries a ✓. Press Escape — select nothing.
  * Type `omarchy-channel-set; echo exit=$?` — `Usage: omarchy-channel-set [stable|rc|edge|dev]`, `exit=1`. Then `omarchy-channel-set bogus; echo exit=$?` — `Unknown channel: bogus`, the usage line, `exit=1`, no sudo prompt.
  * Type `sudo -v` (password `prime`), then `omarchy-refresh-pacman bogus; echo exit=$?` — `Error: Invalid channel 'bogus'. Must be one of: stable, rc, edge`, `exit=1`; then `cmp /etc/pacman.conf /etc/pacman.conf.bak && echo same` — `same` (the backup is taken before the check, the live file is untouched).
  * Type `omarchy-channel-set dev`.
  ** The warning `The dev channel links Omarchy directly to a checkout of the source in ~/omarchy.` / `It's exclusively intended for developers working on Omarchy itself.` and `Switch to dev channel?` with **No** pre-selected. Press Enter (accept No) → `Cancelled.`; `echo $?` → `0`.
  * Open the Omarchy menu with Super+Space → `Update` → `Channel` → `Dev` with the mouse; in the floating terminal answer **No** again → `Cancelled.` then `● Done! Press any key to close...`. Press a key.
  * Type `mkdir -p ~/omarchy && touch ~/omarchy/not-a-checkout; omarchy channel set dev; echo s=$?` and this once answer **Yes** (`y`) to `Switch to dev channel?`.
  ** Expected: `…/omarchy already exists and is not a git checkout.` and a non-zero `s`, with no clone, sudo prompt or pacman output before it — the occupied directory makes the switch refuse before any change. If a download starts anyway, press Ctrl+C at once and report it. Then `rm -rf ~/omarchy`.
  * Type `ls ~/omarchy 2>&1 | head -n 1; sha256sum /etc/pacman.conf /etc/pacman.d/mirrorlist; grep -c omarchy.org /etc/pacman.d/mirrorlist; omarchy channel current; cat /etc/omarchy.conf` — `No such file or directory`, both hashes and the count unchanged, `stable`, `/usr/share/omarchy`. Super+Space → `Update` → `Channel` still shows ✓ on Stable only. Escape; close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Never click Stable/RC/Edge and never confirm Dev on an empty `~/omarchy`: each ends in a full mirror resync and `omarchy update -y` (network, many minutes; own SLOW tests).
  * gum confirm: `n` or Enter on the highlighted No both decline; `y` (or Left then Enter) accepts.
  * Do not run `omarchy-refresh-pacman stable`: it performs a full system upgrade.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the Channel submenu with a single ✓ on Stable, the two `stable` outputs, the usage refusal and `Unknown channel: bogus` with `exit=1`, the `Invalid channel 'bogus'` error with `same`, the dev warning answered No with `Cancelled.` / exit 0, the menu-launched cancel ending in `Done!`, the occupied-checkout refusal with no package output, and the unchanged hashes/count/channel/`/etc/omarchy.conf` afterwards
  * If unsuccessful
  ** A ✓ on the wrong row, disagreeing outputs, `set dev` proceeding without confirmation, a sudo prompt, clone or pacman activity after a refusal or cancel, or a changed hash; the terminal contents and `./client get-serial`
covers: bin/omarchy-channel-set (usage, unknown channel, confirm_dev, occupied checkout), bin/omarchy-channel-current, bin/omarchy-version-channel, bin/omarchy-refresh-pacman (channel guard), default/omarchy/omarchy-menu.jsonc update.channel.* (:354,363-366), manual/30-updates.md (Four channels), manual/31-dotfiles.md (dev channel), test/shell.d/channel-test.sh (current, "dev refuses…", dev refusal before package changes, usage)
merged-from: 43:channel-set-rejects-bad-input; 12:update-channel-current-reject-and-dev-declined; 20:channel-menu-checked-and-set-rejects; 24:channel-menu-current-and-dev-cancel; 51:channel-dev-refuses-occupied-checkout; 21:refresh-pacman-rejects-bad-channel

### channel-switch-edge-and-update   [VM-OK] [NET] [SLOW]
description: Update → Channel → Edge repoints pacman at the edge mirror and repo, swaps `omarchy` for `omarchy-dev` (and `omarchy-settings` for `omarchy-settings-dev`), runs the unattended update with the HEAD-only migrations and no early reboot prompt, and afterwards the channel commands and the menu checkmark say edge; switching back to Stable downgrades and restores the ✓. RC is the same flow with `rc`. The edge disk is kept for the `post-update-edge-*` tests.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy-channel-current; omarchy-version-channel; omarchy-version` — `stable`, `stable`, `4.0.2-…`.
  * Open the Omarchy menu with Super+Space, click `Update`, then `Channel` — `Stable` is shown checked. Click `Edge` with the mouse.
  ** A floating terminal runs `omarchy-channel-set edge`: sudo prompt (type `prime`), `Setting channel to edge`, a full pacman sync, pacman replacing `omarchy` with `omarchy-dev` and `omarchy-settings` with `omarchy-settings-dev`, then the unattended update (`Prune package cache` … `Running migration (…)` …) with no `Reboot now` question before the update pipeline.
  ** Record the `Running migration` lines; besides the 4.0.4 eleven they must include 1786609204, 1786719479, 1787215824, 1787342993, 1787573629, 1787666837, 1788595060, 1788596255, 1788862626, 1788941927, 1789091250, 1789095456, 1789130779, 1789294350, 1789310715.
  * Answer No to the reboot question; press a key at `Done!`.
  * In your terminal type `omarchy-channel-current; omarchy-version-channel; omarchy-version; pacman -Q omarchy-dev omarchy-settings-dev` — `edge`, `edge`, an `omarchy-dev` version string, both packages listed.
  * Type `grep -h Server /etc/pacman.d/mirrorlist /etc/pacman.conf` — `https://mirror.omarchy.org/…` and `https://pkgs.omarchy.org/edge/…`.
  * Open the menu again with Super+Space → `Update` → `Channel`: `Edge` is checked now. Press Escape.
  * Keep this disk (on edge, not rebooted) for the `post-update-edge-*` tests. Only if it is not being kept and budget remains: Super+Space → `Update` → `Channel` → `Stable` (sudo `prime`) — `Setting channel to stable`, pacman may print `warning: downgrading package omarchy`, `omarchy` replaces `omarchy-dev`, the update banners run through `Restarting shell`; answer No to any reboot prompt; then `omarchy-channel-current` → `stable` and the Channel submenu shows ✓ on Stable. End with `stop` either way unless the operator asked for `save`.
  ** RC (`Update → Channel → RC`) is this same flow with `rc` everywhere, the `rc-mirror` and `pkgs.omarchy.org/rc`; it is not run separately.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Two full package transactions plus a kernel: the longest run in this area. Screenshot the floating terminal repeatedly; never sleep more than five seconds. If a switch exceeds the budget, press Ctrl+C, record how far it got, and end with `stop` — never leave the machine half-switched without saying so.
  * On failure the terminal prints `The channel switch did not complete. Review the error above, then rerun: omarchy-channel-set edge` — capture it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the before-state, the Channel submenu with Stable checked, `Setting channel to edge`, the package replacement, the migration lines including the HEAD-only ids, no reboot prompt before the update stage, the after-state commands and Server lines, and the submenu with Edge checked (and, if switched back, `stable` with ✓ on Stable)
  * If unsuccessful
  ** Screenshot of the error and the `The channel switch did not complete…` line, a reboot prompt before the update stage, or a mismatch between the command and the ✓; `omarchy-channel-current` output; `sudo cat /tmp/omarchy-update.log | sudo tee /dev/ttyS0` then `get-serial`
covers: bin/omarchy-channel-set, bin/omarchy-refresh-pacman, bin/omarchy-channel-current, bin/omarchy-version-channel, bin/omarchy-update (-y path), bin/omarchy-update-pacman, default/pacman/pacman-edge.conf, default/pacman/mirrorlist-edge, default/omarchy/omarchy-menu.jsonc update.channel.* (stable/rc/edge), manual/30-updates.md "Four channels", test/shell.d/channel-test.sh (stable/rc paths)
merged-from: 43:channel-switch-edge-and-update; 24:channel-switch-rc-and-back; 51:channel-set-rc-roundtrip

### channel-switch-dev-and-back   [VM-OK] [NET] [SLOW]
description: Update → Channel → Dev warns, asks, clones the Omarchy repository into ~/omarchy, links it as the runtime, installs edge packages and updates; after the requested reboot `omarchy-version` reports `dev (<hash>)`, the next update fast-forwards the checkout, and Update → Channel → Stable brings the machine back to the packaged stable release with the ✓ following along.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `ls ~/omarchy; omarchy-channel-current; omarchy-version` — no checkout, `stable`, `4.0.2-…`.
  * Open the Omarchy menu with Super+Space → `Update` → `Channel` → `Dev` with the mouse.
  ** A floating terminal prints `The dev channel links Omarchy directly to a checkout of the source in ~/omarchy.` / `It's exclusively intended for developers working on Omarchy itself.` and asks `Switch to dev channel?` with **No** highlighted. Choose Yes (Left then Enter, or `y`); type `prime` at the sudo prompt.
  ** `git clone https://github.com/omacom/omarchy.git` scrolls, then the dev-link messages, `Setting channel to edge`, the pacman sync, the `omarchy` → `omarchy-dev` replacement, then the unattended update with migrations. Type `prime` whenever sudo asks. Minutes pass before `Setting channel to edge`.
  * At the end `Updates require reboot. Ready?` (or the kernel variant) appears. Screenshot, answer Yes, type the passphrase `prime` blind at the Plymouth prompt (one try) and land on the desktop.
  ** Until the reboot `omarchy-version` still prints the `omarchy-dev` package version — OMARCHY_PATH is only re-read at login.
  * Open a terminal and type `omarchy-version; omarchy-channel-current; omarchy-version-branch; echo $OMARCHY_PATH; ls ~/omarchy/bin | head -3` — `dev (<7-char hash>)`, `dev`, `master`, `/home/prime/omarchy`, three omarchy scripts. Super+Space → `Update` → `Channel` shows ✓ on Dev; Escape.
  * Type `omarchy update -y` (password `prime`): the first heading after the snapshot is green `Update Omarchy dev checkout` with `Already up to date.` (or a fast-forward), then the rest of the pipeline; answer No to any reboot question.
  * Super+Space → `Update` → `Channel` → `Stable` with the mouse (sudo `prime`): `Setting channel to stable`, another resync that downgrades the too-new packages, `omarchy` replacing `omarchy-dev`, the update run, `Done!`. Then `omarchy-channel-current; omarchy version` — `stable` and a `4.0.x` package version; the Channel submenu shows ✓ on Stable. `~/omarchy` may remain on disk (the checkout is unlinked, not deleted) — note it.
  * The disk has been switched twice: end the session with `stop` (a reboot via Super+Escape → Reboot first, to see the desktop return with the bar drawn, is a bonus if budget remains).
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * A repository clone plus two full mirror resyncs: this is the slowest test in the set. Report the last screenshot and the exact step if time runs out; do not leave the machine half-switched without saying so.
  * The red `The channel switch did not complete. Review the error above, then rerun: omarchy-channel-set <channel>` block is the failure signature.
  * Never sleep more than five seconds between screenshots.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the dev warning answered Yes, the clone, the channel/package steps, the reboot question, the post-reboot `dev (<hash>)` / `dev` / `master` / OMARCHY_PATH with ✓ on Dev, the second update's `Update Omarchy dev checkout` heading, then `stable` with a `4.0.x` version and ✓ on Stable after switching back
  * If unsuccessful
  ** Screenshot of the failure and the `The channel switch did not complete…` line, a pacman error, or a post-reboot session that lost its bar/desktop; `tail -n 40 /tmp/omarchy-update.log | sudo tee /dev/ttyS0` then `get-serial`
covers: bin/omarchy-channel-set (dev, stable), bin/omarchy-dev-link (usage), bin/omarchy-update-dev, bin/omarchy-version, bin/omarchy-version-branch, bin/omarchy-channel-current, bin/omarchy-refresh-pacman, default/omarchy/omarchy-menu.jsonc update.channel.dev/stable, manual/30-updates.md (Four channels), manual/31-dotfiles.md (dev channel), docs/update-process.md "Channels and versions", test/shell.d/channel-test.sh, update-dev-test.sh
merged-from: 43:channel-switch-dev-and-update; 12:update-channel-switch-dev-and-back

### post-update-edge-wrappers-packages-and-sysctl   [VM-PARTIAL]
description: On the edge channel the HEAD-only migrations leave visible state — the `gemini` wrapper replaced by `agy` (a gemini default agent switched to agy, skills linked into ~/.gemini), `vi` and `qt6-multimedia` installed, the KEF wireplumber drop-in written, TCP congestion control on BBR/fq, the `hey`/`ori`/`basecamp`/`cf` wrappers present — the Antigravity migration is a no-op on re-run, and the hardware-gated ones (Dell, Elgato, T3 Code) only show their header.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Precondition: the disk left by `channel-switch-edge-and-update` (on edge, not rebooted). Open a terminal with Super+Enter and type `omarchy-channel-current`.
  ** If it says `stable` this test becomes SLOW: first type `mkdir -p ~/.config/omarchy/defaults; echo gemini > ~/.config/omarchy/defaults/agent`, then `omarchy-channel-set edge`, type `prime` at sudo prompts, wait for the switch and update, and answer No to the reboot question.
  ** On an already-edge disk the default-agent line was not seeded before the migration ran: skip the `agent` file check below and say so.
  * Type `ls -l ~/.local/bin/agy ~/.local/bin/gemini; head -4 ~/.local/bin/agy; cat ~/.config/omarchy/defaults/agent 2>&1` — `agy` exists, `gemini` says `No such file or directory`; the stub contains `mise use -g --quiet "antigravity-cli"`; the agent file (if seeded) says `agy`.
  * Type `ls -l ~/.gemini/config/skills/` — symlinks into `/usr/share/omarchy/default/agents/skills/` (`omarchy`, `diagnose-crash`).
  * Type `pacman -Q vi qt6-multimedia qt6-multimedia-ffmpeg; which vi; sysctl net.ipv4.tcp_congestion_control net.core.default_qdisc` — all three listed, `/usr/bin/vi`, `bbr` and `fq`.
  ** If not `bbr`/`fq`, type `cat /etc/sysctl.d/99-omarchy-sysctl.conf` and report whether it contains `tcp_congestion_control` (the file comes from the settings package, not the migration).
  * Type `ls ~/.config/wireplumber/wireplumber.conf.d/; systemctl --user is-active wireplumber; ls ~/.local/bin/hey ~/.local/bin/ori ~/.local/bin/basecamp ~/.local/bin/cf` — `kef-lsx-no-suspend.conf`, `active`, all four wrappers exist.
  * Type `rm ~/.local/state/omarchy/migrations/1786719479.sh; omarchy-migrate` — `Running migration (1786719479)` / `Replace the Gemini coding agent with Antigravity` runs with no other output and no error (idempotent).
  * Type `grep -A1 'Running migration (178766683\|Running migration (178886262\|Running migration (178909125' /tmp/omarchy-update.log | sudo tee /dev/ttyS0` (password `prime`) and read the serial log: the Dell, Elgato and T3 Code migrations show only their header line.
  ** If the disk was rebooted since the switch, /tmp/omarchy-update.log is gone; skip this step and say so.
  * Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Do not run `agy`; its first run downloads Antigravity.
  * Skipped in the VM: Dell XPS 13 amplifiers, Elgato Cam Link relay, T3 Code theme — no such hardware or package here.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the `ls -l` with `agy` present and `gemini` gone, the stub head and agent file, the skills symlinks, the package/which/sysctl line, the wireplumber file with `active` and the four wrappers, the silent Antigravity re-run, and the serial dump of the three header-only migrations
  * If unsuccessful
  ** Screenshot of `gemini` still present, `agy` missing, the default still `gemini`, a missing package/wrapper/file, or an error under any of the listed migrations; the sysctl file contents if BBR did not apply
covers: migrations/1786609204.sh, 1786719479.sh, 1787215824.sh, 1787342993.sh, 1787666837.sh, 1788596255.sh, 1788862626.sh, 1788941927.sh, 1789091250.sh, 1789130779.sh, 1789294350.sh, 1789310715.sh, bin/omarchy-mise-install, bin/omarchy-pkg-add, bin/omarchy-refresh-config, bin/omarchy-channel-set, test/shell.d/mise-wrapper-quiet-migration-test.sh (wrapper format)
merged-from: 43:post-update-edge-packages-and-sysctl; 43:post-update-edge-gemini-replaced-by-agy

### post-update-edge-work-mise-toml-removed   [VM-OK]
description: On the edge channel the mise-trust migration deletes the stock `~/Work/.mise.toml` that put `{{ cwd }}/bin` on PATH, and re-run on a customised file it removes only that line, keeps a backup and explains that trust was revoked.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Precondition: the disk left by `channel-switch-edge-and-update`. Open a terminal with Super+Enter and type `omarchy-channel-current`.
  ** If it says `stable` this test becomes SLOW: type `omarchy-channel-set edge`, type `prime` at sudo prompts, wait for the switch and update, and answer No to the reboot question.
  * Type `ls -a ~/Work; ls ~/Work/tries` — no `.mise.toml`; `tries` still present.
  * Type `printf '[env]\n_.path = "{{ cwd }}/bin"\nFOO = "bar"\n' > ~/Work/.mise.toml; mise trust ~/Work/.mise.toml; rm ~/.local/state/omarchy/migrations/1789095456.sh; omarchy-migrate`.
  ** Output: `Running migration (1789095456)`, `Automatic project bin directories were removed from your Mise PATH.`, `Your other Mise settings were preserved.`, `Backup saved to:` with a `~/Work/.mise.toml.bak.XXXXXX` path, and `Mise trust for this custom config was revoked. Review it before trusting it again:` / `mise trust /home/prime/Work/.mise.toml`.
  * Type `cat ~/Work/.mise.toml; ls ~/Work/.mise.toml.bak.*` — only `[env]` and `FOO = "bar"` remain; the backup exists.
  * Type `rm -f ~/Work/.mise.toml ~/Work/.mise.toml.bak.*; ls -a ~/Work` — back to no mise file. Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The stock 4.0.2 file matched the migration's known checksum, which is why it was deleted silently during the switch.
  * `cd ~/Work` after the re-run may print a mise "config not trusted" notice for the custom file — that is the revoked trust working.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of `ls -a ~/Work` without `.mise.toml`, the custom-file re-run messages, the trimmed file plus backup, and the cleaned directory
  * If unsuccessful
  ** Screenshot of the stock file surviving, the `_.path` line surviving in the custom file, or a `mise trust --untrust` error aborting the migration
covers: migrations/1789095456.sh, install/user/mise-work.sh (v4.0.2 stock hash), bin/omarchy-migrate
merged-from: 43:post-update-edge-work-mise-toml-removed

### version-commands-and-channel-detection   [VM-OK]
description: The version family is what users paste into support threads: About and `omarchy-version` show the same installed package version as `pacman -Q omarchy`, the channel commands say stable and match pacman's Server lines, `version pkgs` prints the last upgrade date (today at 00:00 on a never-upgraded disk), the hidden `version branch` fails quietly, root binaries swallow a bogus argument, channel detection degrades to `unknown` when the mirrorlist no longer matches a known mirror, and the dev-checkout updater refuses a path that is not a git checkout.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Omarchy menu with Super+Space → `About` with the mouse. The about screen shows the Omarchy version (e.g. `4.0.2-1`). Screenshot, then close it with Escape.
  * Open a terminal with Super+Enter and type `omarchy-version; echo exit=$?; omarchy version; pacman -Q omarchy omarchy-settings` — the same single `4.0.2-<n>` line twice with `exit=0`, equal to the version part of `pacman -Q omarchy`.
  * Type `omarchy-version-channel; omarchy channel current; omarchy-version-branch; echo branch=$?` — `stable`, `stable`, no output, `branch=1`.
  * Type `omarchy version pkgs; grep -c upgraded /var/log/pacman.log; omarchy version bogus; echo exit=$?` — a date such as `Friday, September 18 2026 at 00:00` (quirk: today at midnight on a never-upgraded disk; record it with the `upgraded` count), then the version again with `exit=0` (quirk: the root binary ignores the argument — record, no error expected).
  * Type `grep -E '^(Color|ILoveCandy|ParallelDownloads|Server)' /etc/pacman.conf; grep Server /etc/pacman.d/mirrorlist; ls /usr/share/libalpm/hooks/ | grep omarchy` — `Color`, `ILoveCandy`, `ParallelDownloads = 5`, `Server = https://pkgs.omarchy.org/stable/$arch`, one `https://stable-mirror.omarchy.org/$repo/os/$arch` line, and three `*omarchy*.hook` files.
  * Type `sudo sed -i 's#stable-mirror#other-mirror#' /etc/pacman.d/mirrorlist; omarchy-version-channel; omarchy-channel-current` (password `prime`) — `unknown / stable` and `unknown`. Then `sudo sed -i 's#other-mirror#stable-mirror#' /etc/pacman.d/mirrorlist; omarchy-version-channel; omarchy-channel-current` — `stable`, `stable` again.
  * Type `OMARCHY_PATH=/usr/share/omarchy omarchy-update-dev; echo exit=$?` — no output, `exit=0` (a package-backed install skips the dev step). Then `mkdir -p /tmp/notgit && OMARCHY_PATH=/tmp/notgit omarchy-update-dev; echo exit=$?` — `OMARCHY_PATH is not a git checkout: /tmp/notgit`, non-zero. Then `OMARCHY_PATH=/tmp/notgit omarchy-version` — `dev` (a checkout path reports `dev`; a linked checkout would add its hash).
  * Close the terminal with Super+W; the mirrorlist is as it was.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * `omarchy-version-channel` prints two tokens with a slash only when mirror and package repo disagree. stable → `stable-mirror`, rc → `rc-mirror`, edge → `mirror`.
  * All outputs are one line; screenshot after each command. About may take a second to draw its art.
  * ./client-with-image allows you to get an image back of what you did, so can be useful for speeding things up
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the About screen and the terminal with the matching `4.0.2-n` version and `pacman -Q` line, `stable`/`stable`/`branch=1`, the pkgs date with the `upgraded` count and the `bogus` quirk, the pacman/mirror/hook lines, the `unknown / stable` + `unknown` pair and the restored `stable`/`stable`, the silent dev step, the exact `OMARCHY_PATH is not a git checkout: /tmp/notgit` error and `dev`
  * If unsuccessful
  ** An empty version, About disagreeing with pacman, `unknown` on the untouched disk, a missing error or a git command running against `/usr/share/omarchy`, an error trace, or the mirrorlist not restored
covers: bin/omarchy-version, bin/omarchy-version-channel, bin/omarchy-version-branch, bin/omarchy-version-pkgs, bin/omarchy-channel-current, bin/omarchy-update-dev, bin/omarchy, default/pacman/*, default/pacman/mirrorlist-stable, default/pacman/pacman-stable.conf, default/libalpm/hooks/*, etc/fastfetch/config.jsonc (channel module), docs/update-process.md "Channels and versions", manual/14-omarchy-cli.md, test/shell.d/version-test.sh, channel-test.sh "current channel detects stable", update-dev-test.sh
merged-from: 43:version-commands; 20:version-and-channel-report; 24:version-shown-in-about-and-cli; 52:version-and-dev-update-helpers; 41:pacman-channel-and-mirror-config

### upgrade-to-quattro-refusals-and-decline   [VM-OK]
description: `omarchy upgrade to quattro` is a one-way 3→4 system migration: on this healthy 4.x system its flag validation fails before anything runs, and the banner's `Continue with upgrade?` answered No exits silently with no side effects. Whether the script should refuse or warn on an already-4.x machine is unsettled (re-running is its documented recovery path), so the test records that no "already on Quattro" notice appears — and the driver must never answer Yes.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy-version; sha256sum /etc/pacman.conf; ls /etc/pacman.conf.omarchy-upgrade-to-quattro.* 2>&1; sudo snapper list | tail -1` (password `prime`) — note version, hash and the last snapshot; the `ls` says No such file.
  * Type `omarchy upgrade to quattro --help | head -n 2` — `Usage: omarchy-upgrade-to-quattro [--yes] [--reboot] [--dev] [--channel stable|rc|edge] [--user USER]`.
  * Type each of these and check its red `Error:` line and `exit=1`: `omarchy upgrade to quattro --bogus; echo exit=$?` → `Unknown option: --bogus`; `omarchy-upgrade-to-quattro --channel nightly; echo exit=$?` → `Invalid channel 'nightly'. Use stable, rc, or edge.`; `omarchy-upgrade-to-quattro --dev --channel stable; echo exit=$?` → `--dev needs the edge package repo; use --channel rc or --channel edge.`; `omarchy-upgrade-to-quattro --user nobody-here; echo exit=$?` → `User 'nobody-here' does not exist.`
  ** None of them shows the banner or asks for a password.
  * Type `omarchy-upgrade-to-quattro` with no flags.
  ** The screen clears and shows a large QUATTRO block-letter banner, then `Upgrading Omarchy to Quattro is a one-way street!`, `You cannot downgrade from Quattro.`, `Make sure you have a backup.` and `Continue with upgrade?`. Screenshot it, and record that no "this machine already appears to be on Quattro" notice or refusal appeared before the question (flagged for maintainers; not a failure).
  * Answer **No** (press `n`). The command exits with no further output; `echo $?` → `0`; no sudo prompt appeared.
  ** Never answer Yes and never pass `--yes`: the script would start rewriting pacman configuration on this healthy 4.x system.
  * Type `omarchy-version; sha256sum /etc/pacman.conf; ls /etc/pacman.conf.omarchy-upgrade-to-quattro.* 2>&1; sudo snapper list | tail -1` — version and hash unchanged, still no backup file, no new snapshot. Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If the question does not appear and green `==>` progress lines start, press Ctrl+C immediately and report it: the confirmation gate would be broken. Do not reboot after such a run.
  * `omarchy upgrade to quattro` (the CLI router spelling) and `omarchy-upgrade-to-quattro` reach the same script.
  * ./client-with-image allows you to get an image back of what you did, so can be useful for speeding things up
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the usage line, the four argument refusals with their `Error:` lines and exit 1, the banner with the one-way warning and the question (with a note that no "already on Quattro" notice preceded it), the silent exit 0 after No, and the unchanged version/hash/backup listing/snapshot tail
  * If unsuccessful
  ** Screenshot of any `==>` progress line, sudo prompt, new `/etc/pacman.conf.omarchy-upgrade-to-quattro.*.bak`, or changed hash after declining, or a validation error arriving after the banner; `Upgrade incomplete - do NOT reboot.` if it ever appears, plus `get-serial`
covers: bin/omarchy-upgrade-to-quattro (usage :1-175, normalize_channel, argument refusals, banner + gum confirm :334-353, cleanup_on_exit), agents/skills/migrations.md "Omarchy 4.0 is upgraded through bin/omarchy-upgrade-to-quattro", test/shell.d/upgrade-to-quattro-test.sh "reports an aborted run instead of exiting silently"
merged-from: 43:upgrade-to-quattro-refuses-on-quattro; 20:upgrade-to-quattro-flags-and-decline

### reinstall-declined-and-configs-reset   [VM-OK]
description: `omarchy reinstall` is destructive (reinstalls packages and overwrites `~/.config`), so it shows its warning and does nothing at all when declined or interrupted; `omarchy reinstall configs` — the documented "reset everything" escape hatch — replays /etc/skel over the home without asking, wiping user edits to shipped files (no backup) while leaving extra files alone, refuses to run as root, and the desktop stays healthy afterwards.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy reinstall --help | head -n 4` — help for `omarchy reinstall` and its summary; nothing runs. Then `echo '-- REINSTALL-PROBE' >> ~/.config/hypr/looknfeel.lua; echo '# marker' >> ~/.bashrc; touch ~/.config/hypr/my-own-file.lua; tail -n 1 ~/.config/hypr/looknfeel.lua; pacman -Q | wc -l` — the probe line and the package count.
  * Type `omarchy reinstall; echo exit=$?`.
  ** `This will reinstall all default Omarchy packages and reset default configs.` / `Warning: user config changes will be overwritten.` then `Are you sure you want to reinstall and lose config changes?`. Choose **No** (Right arrow then Enter, or `n`): the prompt returns with `exit=0`, no sudo prompt, no package output.
  * Type `omarchy-reinstall` and press Ctrl+C at the question. Then `tail -1 ~/.bashrc; pacman -Q | wc -l; omarchy version` — the marker is still there, the count and version unchanged.
  * Type `sudo omarchy reinstall configs; echo exit=$?` — `Error: This script should not be run as root`, `exit=1`.
  * Type `omarchy reinstall configs; echo exit=$?`.
  ** `Resetting Omarchy user configs to shipped defaults...`, no confirmation asked, then the limine/plymouth refresh (a sudo prompt may appear: type `prime`; bootloader output is expected, ~30 s to two minutes) and the Neovim refresh, `exit=0`.
  * Type `tail -n 1 ~/.config/hypr/looknfeel.lua; cmp /etc/skel/.bashrc ~/.bashrc && echo restored; ls ~/.config/hypr/*.bak.* 2>&1; ls ~/.config/hypr/my-own-file.lua; hyprctl configerrors` — the probe line is gone (the file ends with the shipped `-- })` block), `restored`, `No such file` (no backup, as documented), the extra file still present, no config errors. The bar is up.
  * Press Super+Enter — a fresh terminal opens normally with the restored shell config. Type `rm ~/.config/hypr/my-own-file.lua` and close both terminals with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * gum confirm highlights `Yes` by default — move to `No` before pressing Enter. Never choose Yes: the real reinstall downloads packages and exceeds the session budget (see the appendix).
  * The plymouth refresh rebuilds the initramfs and can take a minute or two; keep screenshotting.
  * ./client-with-image allows you to get an image back of what you did, so can be useful for speeding things up
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the help, the warning + confirm declined with `exit=0`, the Ctrl+C path with the intact marker/count/version, the root refusal with `exit=1`, the reset run with `exit=0`, the probe gone / `restored` / no `.bak` / extra file kept / empty `hyprctl configerrors`, and the new terminal
  * If unsuccessful
  ** A pacman/sudo prompt after No, the marker or sentinel removed after declining, a failing refresh step's error, or `.bashrc`/`looknfeel.lua` unchanged after the reset; `diff /etc/skel/.config/hypr/bindings.lua ~/.config/hypr/bindings.lua`; `./client get-serial`
covers: bin/omarchy-reinstall, bin/omarchy-reinstall-configs, manual/30-updates.md (Rolling back bad updates), manual/31-dotfiles.md (Resetting any changes), manual/42-common-tweaks.md, manual/45:5, docs/file-layout.md §Explicit resync, default/agents/skills/omarchy/SKILL.md §Troubleshooting (omarchy reinstall)
merged-from: 12:reinstall-declined-and-configs-reset; 13:omarchy-reinstall-cancel-leaves-system-untouched; 20:reinstall-confirm-declined; 23:reinstall-configs-resets-home; 61:reinstall-configs-resync

### update-menu-rows-and-process-restart-shell   [VM-OK]
description: The Update submenu lists the maintenance rows with Channel Stable ✓ and the Restart/Reset headers, and Update → Process → Shell restarts the Omarchy shell in place — the bar vanishes and returns, a live toast survives, the menu and hotkeys work afterwards, and two back-to-back restarts still leave exactly one shell process.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy-notification-send -u critical "Survivor" "still here after restart"` — a persistent toast appears. Leave the terminal open.
  * Press Super+Space → `Update`.
  ** Rows: Omarchy, Channel, Config, Process, Hardware, Firmware, Password, Timezone, Time. `Extra Themes` is absent.
  * Open `Channel` — Stable ✓, RC, Edge, Dev with 🟢🟡🟠🔴. Backspace to go back. Open `Config` — header `Reset to default…`; Hyprland, Hyprsunset, Plymouth, Tmux, Shell. Backspace.
  * Open `Process` → `Shell` (header `Restart…`).
  ** The bar disappears briefly and is back within a few seconds; the `Survivor` toast is restored.
  ** Do NOT pick `Config → Shell` (`Reset to default`): it rewrites shell.json (own test).
  * Press Super+Space: the menu opens. Escape. Press Super+, — the toast is dismissed.
  * Unhappy path: in the terminal type `omarchy restart shell; omarchy restart shell` — the bar comes back once; then `pgrep -c quickshell` → `1`.
  * Press Super+W; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The restart takes two or three seconds; take screenshots every second after Process → Shell to catch the bar returning.
  * Do not select Omarchy, Firmware, Time, Hardware or any Channel row here — each has its own test.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the Update rows, Channel with Stable ✓, the Config header and rows, the toast, the bar gone, the bar back with the toast, the menu afterwards, and the process count of 1
  * If unsuccessful
  ** Screenshot of the missing bar after ten seconds, a missing/extra row, or a count other than 1; `./client get-serial`
covers: default/omarchy/omarchy-menu.jsonc update.* (:368 process.shell), bin/omarchy-restart-shell, bin/omarchy-theme-extras (when), bin/omarchy-show-done, docs/notifications.md (persistence), manual/05:3
merged-from: 22:menu-update-submenu-entries; 10:update-process-restart-shell

### update-config-shell-resets-bar-position   [VM-OK]
description: Update → Config → Shell restores ~/.config/omarchy/shell.json to the shipped default (bar back on top) with a timestamped `.bak.<epoch>` backup and a diff, and the per-file CLI refuses a path that is not a shipped user config — shell.json is the file the manual names for bar/idle settings, and this is its documented reset.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Omarchy menu with Super+Space → `Style` → `Menu Bar` → `Position` → `Bottom`. The bar moves to the bottom edge.
  * Open a terminal with Super+Enter and type `grep -n '"position"' ~/.config/omarchy/shell.json` → `"position": "bottom"`.
  * Open the Omarchy menu → `Update` → `Config` → `Shell`.
  ** The floating terminal prints `Replaced /home/prime/.config/omarchy/shell.json with new Omarchy default. Saved backup as …shell.json.bak.<epoch>` and a diff containing the position line; the shell restarts (bar disappears and reappears at the top); `● Done!`.
  * Press a key to close. Type `grep -n '"position"' ~/.config/omarchy/shell.json` → `"position": "top"`, and `ls ~/.config/omarchy/shell.json.bak.*` lists one backup.
  * Negative: `omarchy-refresh-config not/a/file; echo exit=$?` → `Not a shipped user config: not/a/file`, `exit=1`.
  * Clean up: `rm ~/.config/omarchy/shell.json.bak.*`; close the terminal with Super+W. The bar is on top as it started.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The bar takes a second or two to come back after the shell restart; allow 20 s for the position change.
  * Menu guards paint from the previous evaluation; if a row looks stale, reopen the menu.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the bar at the bottom, the Replaced/diff output, and the bar at the top again; the grep output before/after and the `Not a shipped user config` refusal
  * If unsuccessful
  ** The floating terminal output, the shell.json contents, `./client get-serial`
covers: manual/31-dotfiles.md (shell.json, Resetting any changes), bin/omarchy-refresh-shell, bin/omarchy-refresh-config, default/omarchy/omarchy-menu.jsonc update.config.shell, style.bar.position.*
merged-from: 12:update-config-shell-resets-bar-position

### update-hardware-rows-without-hardware   [VM-PARTIAL]
description: Update → Hardware → Wi-Fi/Bluetooth/Trackpad/Audio each run their restart helper in a floating terminal and finish cleanly even when the hardware is absent — the manual points users here before rebooting; a helper that crashes or prompts for sudo without hardware would be worse than useless. Only the absence path exists in the guest.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Omarchy menu with Super+Space → `Update` → `Hardware` → `Wi-Fi`.
  ** Floating terminal prints `Unblocking wifi...` followed by (empty) rfkill output, then `● Done!`. Press a key.
  * `Update` → `Hardware` → `Bluetooth` → `Unblocking bluetooth...` then `● Done!` (or `Failed (exit code N)!` — record which). Press a key.
  * `Update` → `Hardware` → `Trackpad` → no device found, so it prints nothing (no `Reloading intel_quicki2c`) and ends `Done!`; it must not prompt for sudo when there is no device. Press a key.
  * `Update` → `Hardware` → `Audio` → `Restarting audio services...`, possibly `Audio status:` with `wpctl status` output listing PipeWire and the `Dummy Output` sink, then `Done!` (or `Failed (exit code 1)` with `Audio services are still not responding` — record which; the guest has no sound card).
  * After the audio restart confirm the bar still draws and the audio panel opens (Super+Ctrl+2 on this VM, or click the audio icon) — it may list only the Dummy Output. Escape.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The audio restart waits up to 25 s twice; keep screenshotting every few seconds.
  * Skipped part: real Wi-Fi/Bluetooth/trackpad recovery; these rows have no guards and stay visible on the VM.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Four screenshots of the floating terminals ending in `Done!` (or the explained audio/bluetooth `Failed`), and the bar intact with the audio panel afterwards
  * If unsuccessful
  ** A bash error, an unexpected sudo prompt for Trackpad, or a shell crash; `./client get-serial`
covers: manual/35-networking.md (When it stops working), default/omarchy/omarchy-menu.jsonc update.hardware.*, bin/omarchy-restart-wifi, bin/omarchy-restart-bluetooth, bin/omarchy-restart-trackpad, bin/omarchy-restart-audio
merged-from: 12:update-hardware-restart-rows-in-vm

### update-firmware-no-devices   [VM-PARTIAL] [NET]
description: Update → Firmware installs fwupd on first use, refreshes LVFS metadata and reports that nothing is updatable on this machine, closing cleanly rather than with an error stack; a second run skips the install. In QEMU only this "no devices" path exists (~5 MB download).
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `pacman -Q fwupd` — `was not found` on a fresh disk (record if it is already present).
  * Open the Omarchy menu with Super+Space → `Update` → `Firmware` with the mouse.
  ** A floating terminal shows the logo and the green `Update Firmware`, pacman installing `fwupd` (type `prime` at the sudo prompt), `fwupdmgr refresh --force` downloading metadata (`Successfully downloaded new metadata` or similar), then `sudo fwupdmgr update` reporting no updatable devices (`Devices with no available firmware updates:` / `No updatable devices`, or a list of virtual devices with nothing to do).
  ** fwupdmgr may ask `Do you want to upload report now?` or similar — answer N.
  * It ends with `● Done! Press any key to close...` or `● Failed (exit code N)!` — record which. Exit code 2 from fwupdmgr ("nothing to do") is acceptable if the text explains it; a bash error, a missing command or a stack trace is not. Press a key; the desktop is as before.
  * In your terminal type `pacman -Q fwupd; ls /boot/EFI/arch/fwupdx64.efi; fwupdmgr get-devices 2>&1 | head -n 20` — installed, the EFI helper copied (UEFI guest), and the tool answering.
  * Run the menu entry a second time: no package install this time, straight to refresh/update, same ending. Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * QEMU exposes no updatable firmware; the flow completing gracefully is the point. Skipped: real flashing and the reboot-to-apply path.
  * fwupd stays installed afterwards (disk altered slightly); note it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of `Update Firmware`, the fwupd install, the metadata refresh, the no-updatable-devices output, the closing line with its explanation, `pacman -Q fwupd` with the EFI file and `get-devices`, and the second run without an install
  * If unsuccessful
  ** Screenshot of a pacman or fwupdmgr error other than the no-devices message (package install failure, refresh network error, command not found) and the `Failed (exit code N)` line; `./client get-serial`
covers: bin/omarchy-update-firmware, default/omarchy/omarchy-menu.jsonc update.firmware, manual/30-updates.md "Firmware updates"
merged-from: 43:update-firmware-no-devices; 12:update-firmware-no-devices; 24:update-firmware-in-vm

### update-time-restarts-timesyncd   [VM-OK]
description: Update → Time restarts systemd-timesyncd behind an `Updating time...` message after one sudo prompt and closes with Done, leaving the service active; cancelling at the password prompt leaves the service untouched.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `systemctl show -p ActiveEnterTimestamp systemd-timesyncd` and note the timestamp.
  * Open the Omarchy menu with Super+Space → `Update` → `Time` with the mouse.
  ** A floating terminal shows the logo, `Updating time...`, a sudo prompt (type `prime`), then `● Done! Press any key to close...`. Press a key.
  * Type `systemctl show -p ActiveEnterTimestamp systemd-timesyncd; systemctl is-active systemd-timesyncd` — a newer timestamp and `active`.
  * Type `omarchy-update-time` and press Ctrl+C at the sudo prompt — the command aborts; repeat the `systemctl show` line: the timestamp is unchanged.
  * Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * `System clock synchronized: yes` in timedatectl can lag a minute and is not required.
  * If timesyncd is not enabled on the image, `is-active` reports `inactive` after the restart; report it as-is.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the first timestamp, the floating terminal with `Updating time...` and `Done!`, the newer timestamp with `active`, and the unchanged timestamp after the Ctrl+C
  * If unsuccessful
  ** Screenshot of a systemctl error or a `Failed (exit code N)` closing line; `systemctl status systemd-timesyncd | sudo tee /dev/ttyS0` via `get-serial`
covers: bin/omarchy-update-time, default/omarchy/omarchy-menu.jsonc update.time
merged-from: 43:update-time-restarts-timesyncd; 24:update-time-restarts-timesyncd

### update-extra-themes-row-appears-with-git-theme   [VM-OK]
description: Update → Extra Themes appears only once a git-installed theme exists — a hand-written user theme does not count — and `omarchy theme update` with none installed is a silent no-op.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Space → `Update`. The list has no `Extra Themes` entry. Escape.
  * Open a terminal with Super+Enter and type `omarchy theme update; echo exit=$?` → no output, `exit=0`.
  * Type `mkdir -p ~/.config/omarchy/themes/handmade && cp /usr/share/omarchy/themes/nord/colors.toml ~/.config/omarchy/themes/handmade/`. Press Super+Space → `Update`: still no `Extra Themes` (a hand-written theme is not an extra to pull). Escape.
  * Type `cd ~/.config/omarchy/themes/handmade && git init -q && git add -A && git -c user.email=a@b -c user.name=a commit -qm i && cd ~`. Press Super+Space → `Update`: `Extra Themes` is now listed.
  * Click it: the floating terminal prints `Updating: handmade` and a git message (no remote → `fatal: No remote repository specified` is acceptable), then a Done/Failed banner. Press a key.
  * Type `rm -rf ~/.config/omarchy/themes/handmade`; Super+Space → `Update`: `Extra Themes` is gone again. Escape; close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The menu evaluates visibility conditions when opened and paints from the previous evaluation: reopen it twice after each change before asserting a row appeared or vanished.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Update menu without `Extra Themes` (twice), with it (once) and without it again after cleanup; the silent `exit=0`; `Updating: handmade` in the floating terminal
  * If unsuccessful
  ** Menu screenshot with the wrong visibility, or the floating terminal's error
covers: bin/omarchy-theme-extras, bin/omarchy-theme-update, default/omarchy/omarchy-menu.jsonc update.themes (when)
merged-from: 21:theme-update-extras-hidden-when-none

### update-hook-post-update-invitations-once   [VM-OK]
description: The first-run hooks installed for post-update fire their one-time invitations (Install Dictation with Voxtype, Set your default agent) on the first `omarchy-hook post-update` and never again, and the fingerprint invitation never appears on a machine without a reader. Must run on a disk that has not been updated yet — the real update consumes these.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `ls ~/.local/state/omarchy/done/ | grep -c invitation` → `0` (no invitation has been shown yet on this disk).
  ** If the count is not 0 the disk has already been updated; report it and stop — this test needs a stock disk.
  * Type `omarchy-hook post-update`.
  ** Two toasts must appear: **Install Dictation with Voxtype** (`Click to install voice dictation for Omarchy.`) and **Set your default agent** (`Let your favorite agent help with Omarchy.`). No **Setup Fingerprint Reader** toast. Screenshot right away — toasts fade.
  * Type `ls ~/.local/state/omarchy/done/` → now includes `voxtype-install-invitation` and `agent-setup-invitation`, but not `fingerprint-setup-invitation`.
  * Unhappy path (once-only): type `omarchy-hook post-update` again → no new toast appears (wait 10 s with screenshots).
  * Click **Set your default agent** if still visible → the Omarchy Menu opens on the default-agent submenu; press Escape. Do not click **Install Dictation with Voxtype** — it starts a large network install.
  * Type `omarchy-hw-fingerprint; echo $?` → `1`.
  * Round trip: type `rm ~/.local/state/omarchy/done/voxtype-install-invitation ~/.local/state/omarchy/done/agent-setup-invitation` so the first real update on this disk still shows them once; close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The first-run "Set your default agent" notification may already have been consumed on the minted disk; the post-update markers are separate and must start absent.
  * Toasts fade; screenshot right after running the hook.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the two toasts after the first `omarchy-hook post-update`, the done directory with the two new markers and no fingerprint marker, no toast after the second run, the menu opened from the agent toast, `1` from `omarchy-hw-fingerprint`, and the markers removed again
  * If unsuccessful
  ** Terminal output of `omarchy-hook post-update` (a `Hook failed:` line) and the done directory listing
covers: install/user/first-run/{install-voxtype,setup-agent,setup-fingerprint}.hook, bin/omarchy-hook, bin/omarchy-hook-install, bin/omarchy-done (ensure), bin/omarchy-hw-fingerprint
merged-from: 42:firstrun-post-update-invitations-once

### preinstalls-remove-decline-and-confirm   [VM-OK]
description: Remove → Preinstalls asks first and declining changes nothing; confirming strips the shipped web apps, TUIs, agent stubs and the 13 desktop packages (no download), records the opt-out, kills the preinstalled-app chords after the Hyprland reload, flips the Install/Remove rows and hides the Web App/TUI removers, while a user's own tool in ~/.local/bin survives. The disk is altered: end with `stop`.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Baseline: press Super+Shift+A — the ChatGPT web app opens; close it with Super+W. Open Apps with Super+Alt+Space, type `basecamp` — `Basecamp` is listed; type `obsidian` — `Obsidian`. Escape. Open a terminal with Super+Enter and type `pacman -Q obsidian libreoffice-fresh omacalc | wc -l; ls ~/.local/bin | grep -cE '^(claude|gh|codex|opencode|hermes|agy|omp|ori|grok|crush|cursor-agent|muse)$'` — `3` and a non-zero stub count (note it). Then `printf '#!/bin/bash\necho user-muse\n' > ~/.local/bin/muse; chmod +x ~/.local/bin/muse` — a user-managed `muse` is in place.
  * Open the Omarchy menu with Super+Space → `Remove` → `Preinstalls`. In the floating terminal, at `Are you sure you want to remove all preinstalled web apps, TUI wrappers, and desktop applications?` choose **No** (arrow/Tab to No, Enter) → `Done!`; press a key.
  ** Apps → `basecamp` still listed; `pacman -Q obsidian` still installed; Super+Space → `Remove` still lists `Preinstalls` and `Install` → `Preinstalls` is still dimmed ✓ (reopen the menu twice — guards paint from the previous evaluation).
  * Super+Space → `Remove` → `Preinstalls` → **Yes**; type `prime` at the sudo prompt.
  ** `Removing preinstalled Omarchy applications...` with `Removing web app: …` lines, then pacman removes aether cliamp libreoffice-fresh xournalpp pinta obsidian obs-studio kdenlive moonlight-qt lazydocker omacut omacalc omawrite (no download, one to two minutes), `Done!`. Press a key. A pacman dependency error here is the finding — screenshot it.
  * Press Super+Shift+A — **nothing** opens; Super+Ctrl+Q and Super+Shift+W — nothing opens and no error dialog; Super+Enter — a terminal still opens.
  ** If ChatGPT still opens, type `hyprctl reload` in the terminal, retry, and report that the script's own reload did not take.
  * In the terminal type `pacman -Q obsidian libreoffice-fresh omacalc pinta aether 2>&1; ls ~/.local/bin | grep -cE '^(claude|gh|codex|opencode|hermes|agy|omp|ori|grok|crush|cursor-agent)$'; ~/.local/bin/muse; ls ~/.local/state/omarchy/preinstalls-removed; ls ~/.local/share/applications` — five `was not found` lines, `0`, `user-muse`, the marker present, no web-app or TUI desktop files.
  * Apps (Super+Alt+Space): `basecamp`, `obsidian`, `libre`, `Omacut` → nothing listed. Press Super+K: the Obsidian binding (Super+O) is no longer listed. Super+Space → `Remove`: the `Preinstalls`, `Web App` and `TUI` rows are gone; `Install` → `Preinstalls` is selectable (not dimmed) — do NOT select it (~700 MB; own test).
  * Type `rm ~/.local/bin/muse`; end the session with `stop` so the next test starts stock.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The floating terminal asks a gum yes/no; `y` confirms, `n` declines.
  * The hotkey gating relies on `omarchy_preinstalled_bindings` being switched off and `hyprctl reload` run by the script.
  * Two windows would tile side by side; a chord that opens nothing leaves the desktop unchanged.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the baseline (ChatGPT, Basecamp/Obsidian rows, counts), the confirmation declined with Basecamp still listed and the rows unchanged, the removal log ending `Done!`, the dead chords (desktop unchanged) with a terminal still opening, the terminal checks (`was not found` ×5, stub count `0`, `user-muse`, the marker, no web-app desktop files), the empty launcher searches, Super+K without Obsidian, and the Remove menu without Preinstalls/Web App/TUI with Install → Preinstalls enabled
  * If unsuccessful
  ** Screenshot of the red Failed line or pacman error, packages or web apps surviving after Yes, changes after No, a stub surviving, `muse` overwritten, or ChatGPT still bound; `cat ~/.local/state/omarchy/preinstalls-removed; ls ~/.local/share/applications`
covers: bin/omarchy-remove-preinstalls, bin/omarchy-webapp-remove-all, bin/omarchy-tui-remove-all, install/omarchy-base.packages, default/hypr/helpers.lua:84-90, default/hypr/bindings/applications.lua:10-34, default/omarchy/omarchy-menu.jsonc remove.preinstalls / install.preinstalls (:216,297), manual/25-web-apps.md:7, manual/46:75-81, manual/01-welcome-to-omarchy.md, test/shell.d/preinstalls-test.sh (l.69), default-agent-test.sh (Remove Preinstalls), hyprland-default-config-test.sh (preinstall flag skips bindings)
merged-from: 23:remove-preinstalls-and-decline; 22:menu-remove-preinstalls-cancel; 13:faq-remove-preinstalls-and-install-back-entry; 51:remove-preinstalls; 60:preinstalls-remove-drops-org-apps; 11:remove-preinstalls-disables-webapp-hotkeys

### preinstalls-restore-after-remove   [VM-OK] [NET] [SLOW]
description: After Remove Preinstalls, Install → Preinstalls asks first (declining leaves the opt-out in place), then puts the shipped launchers, agent stubs and 13 packages back and clears the opt-out only once the packages are installed, re-dimming the Install row and restoring the Remove row and the web-app chords.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `pacman -Q omacut omacalc omawrite; ls ~/.local/state/omarchy/preinstalls-removed 2>&1` — all three installed; the marker absent. Then type `omarchy-remove-preinstalls`, choose **Yes**, sudo `prime`, and wait for it to finish (offline, ~1 min). Open Apps (Super+Alt+Space), type `obsidian` — nothing. Escape.
  * Open the Omarchy menu with Super+Space → `Install` → `Preinstalls` (now enabled). At `Are you sure you want to restore all preinstalled web apps, TUI wrappers, and desktop applications?` choose **No** → `Done!`. Reopen the menu twice: `Install` → `Preinstalls` is still enabled; `ls ~/.local/state/omarchy/preinstalls-removed` still present.
  * Super+Space → `Install` → `Preinstalls` → **Yes**; type `prime`.
  ** `Restoring preinstalled Omarchy applications...`, then pacman downloads ~700 MB (5–10 minutes; screenshot every 5 s, never sleep longer), `Done!`. Press a key.
  ** On a pacman failure the floating terminal prints `Preinstalls are still marked as removed. Fix the errors above and try again.` — capture it; the marker must then still be present (correct fail-safe behaviour).
  * Apps (Super+Alt+Space): `basecamp` → `Basecamp`; `obsidian` → `Obsidian`; `libre` → LibreOffice entries. Escape. Press Super+Shift+A — ChatGPT opens again; close it with Super+W.
  * In the terminal type `pacman -Q omacut omacalc omawrite obsidian; ls ~/.local/bin | grep -cE '^(claude|gh|codex|opencode|hermes)$'; ls ~/.local/state/omarchy/preinstalls-removed 2>&1` — all installed again, the stub count back to non-zero (`5` at HEAD), the marker gone.
  * Reopen the menu twice: `Install` → `Preinstalls` dim ✓; `Remove` → `Preinstalls` listed again. End the session with `stop` unless the reinstall completed cleanly and the operator wants the disk.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The download may exceed the session budget; if so, report SLOW with the last pacman progress line and the marker still present.
  * Start the restore early in the session.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the packages gone with the marker present, the declined restore leaving the row enabled and the marker in place, `Restoring...`, pacman progress, `Done!`, the launcher entries back, ChatGPT opening, the packages and stubs back with the marker gone, and the rows flipped back
  * If unsuccessful
  ** The `Preinstalls are still marked as removed` line with the pacman error above it, the marker cleared while packages are still missing, or the Install row dimmed while removed; `omarchy-version`
covers: bin/omarchy-install-preinstalls, bin/omarchy-remove-preinstalls, bin/omarchy-refresh-applications, install/omarchy-base.packages, default/omarchy/omarchy-menu.jsonc (install.preinstalls, remove.preinstalls), test/shell.d/preinstalls-test.sh, menu-test.sh, manual/22-guis.md
merged-from: 23:install-preinstalls-restores; 52:preinstalls-remove-and-restore

## Not runnable here

### reinstall-full-packages   [VM-NO] [NET] [SLOW]
description: `omarchy-reinstall` (Yes path) — the troubleshooting last resort — switches to stable mirrors, downgrades newer packages, reinstalls every base package from the stable mirrors, resets user configs and offers a reboot: a full system transaction with unbounded downloads, beyond the session budget on a 4.0.2 disk. Its cancel path is `reinstall-declined-and-configs-reset`.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `echo '# my tweak' >> ~/.config/hypr/bindings.lua` so the reset is visible.
  * Type `omarchy-reinstall`; choose **Yes**; sudo `prime`.
  * Watch the stable-mirror refresh, the `-Suu` downgrade and the `-Syu --needed <base packages>` transaction (screenshot every 5 s), then `Resetting Omarchy user configs to shipped defaults...`.
  ** A `Woah partner` message here would be a bug: the reinstall sets `OMARCHY_UPDATE_PACMAN=1` to bypass the guard.
  * At `System has been reinstalled. Reboot?` choose **No**; type `pacman -Qi omarchy | grep -i version; cmp /etc/skel/.bashrc ~/.bashrc && echo restored; grep -c 'my tweak' ~/.config/hypr/bindings.lua` — the stable version, `restored`, `0`.
  * Reboot via Super+Escape → Reboot (passphrase `prime`): the Limine menu is intact and the desktop returns.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Expect 10+ minutes of downloads. Pipe long pacman output with `| sudo tee /dev/ttyS0` and read it with get-serial if the terminal scrolls too fast.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The two pacman transactions completing, the config reset line, the declined reboot, the version check, `restored`, the tweak gone, and the desktop after the reboot
  * If unsuccessful
  ** pacman conflicts or the guard message, `omarchy-refresh-limine` errors, or the tweak surviving
covers: bin/omarchy-reinstall, bin/omarchy-reinstall-pkgs, bin/omarchy-reinstall-configs, default/pacman/*, default/libalpm/hooks/00-omarchy-update-guard.hook, manual/45:5
merged-from: 23:reinstall-full-packages; 13:omarchy-reinstall-full

## Moved to other domains

- 12:laptop-mirror-and-clamshell-real → C — extend/mirror/clamshell/brightness `VM-NO` record; monitor and lid behaviour is Hyprland/window territory, nothing in it touches updating.
- 40:hypr-preinstalled-bindings-disabled-flag → C — a `hyprland.lua` flag edit (`omarchy_preinstalled_bindings = false`) toggling chords via `hyprctl reload`; a Hyprland config-binding story, not the preinstalls remover.
- 22:preinstalled-webapp-chords-and-focus → F2 — Super+Shift web-app chords opening sites and the focus-or-launch behaviour; an apps-in-use story.
- 23:install-menu-marks-preinstalled-rows → F1 — an inventory walk of every Install submenu and its dim ✓ rows; Install machinery, not update.
- 23:dev-env-php-pacman-path → F1 — Install/Remove → Development → PHP; a dev-env install story routed here on the word "pacman".
- 25:plugin-add-local-git-repo-enable-update-remove → F1 — plugin add/enable/update/remove lifecycle from a local `file://` repo; joins 32:plugin-add-local-enable-disable-remove there.
- 32:plugin-update-local-origin-and-rollback → F1 — `omarchy plugin update` fast-forward and rollback; builds on F1's plugin-add test ("exactly as in `plugin-add-local-enable-disable-remove`").
- 30:notification-replace-updates-card-in-place → D — `omarchy-notification-send -r` replacing a toast in place; a notification-daemon story routed here on the word "update".
- 41:plocate-updatedb-config → H — the `plocate-updatedb` unit drop-ins and snapshot pruning; a system-configuration story routed here on "updatedb".
- 22:agent-usage-update-without-auth → G2 — `omarchy agent usage-update` collectors failing per agent without a login; a CLI/agent story routed here on "update".
- 20:dev-add-migration-temp-repo → G2 — `omarchy dev add migration --no-edit` scaffolding a migration file in a checkout; developer tooling, not a migration the user runs.
- 61:agent-skill-debug-and-version → G2 — `omarchy debug --no-sudo --print` and the log header; the version line it opens with is already asserted in `version-commands-and-channel-detection`.

## Dropped

- None.
