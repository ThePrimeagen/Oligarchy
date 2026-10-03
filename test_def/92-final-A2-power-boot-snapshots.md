# Power, boot chain and snapshots — final tests

This domain covers the System menu's power actions (reboot, shutdown; suspend is one-way in QEMU and
belongs to A1), the whole boot chain on `--resume` (Limine menu and its Snapshots submenu, the
Plymouth LUKS prompt, the UKI and its config), Snapper snapshots (create, retention, boot into one,
the restore picker, the real restore, the silent unknown-action defect), Direct Boot, Factory Reset
(cancel paths, the refusal without `@factory`, the full new-owner cycle), the LUKS passphrase change
and its rejections, and the battery/laptop absence paths this guest exhibits. 65 source blocks plus 4
routed in from A1/B/D (69) → 27 tests (56 blocks merged), 0 not runnable, 12 moved, 0 dropped, 1
rerouted. Notable merges: eight reboot/Plymouth/Limine/autologin blocks became one
`reboot-from-system-menu-full-boot-chain`; six snapshot-create blocks became
one create/retention/unknown-action test; the three factory-reset full-cycle blocks were merged with
24's `VM-NO` overruled by 01-FACTS (testable, 8–12 min at the budget edge); the six drive-password
blocks became two tests with the reboots cut from four to one by proving keys with
`cryptsetup --test-passphrase`; the three Direct Boot blocks were merged with the BootOrder
disagreement settled on the side of `efibootmgr --create` (new entry first, Limine skipped). Safety
rules from 01-FACTS are applied verbatim: every LUKS change ends back at `prime`, exactly one wrong
LUKS try at boot, `stop` (never `save`) after anything that touches `@factory`, and Suspend is never
selected in this domain.

## Tests

### system-menu-power-entries-listed   [VM-OK]
description: Super+Escape opens the System menu listing exactly the power actions this machine supports — Screensaver, Lock, Suspend, Logout, Reboot, Shutdown and no Hibernate without hibernation swap — and Escape closes it without acting.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Escape. The Omarchy Menu opens directly on the System submenu.
  * The rows must be, in order: Screensaver, Lock, Suspend, Logout, Reboot, Shutdown — and no Hibernate.
  ** Do not type while the menu is open (typing filters the rows) and do not select Suspend or Hibernate: suspend is one-way in this guest.
  * Press Escape. The menu closes and the desktop is unchanged.
  * Press Super+Space and click System with the mouse: the same six rows. Press Escape.
  * Open a terminal (Super+Enter) and type `swapon --show` (only `/dev/zram0`) and `omarchy-hibernation-remove` — "Hibernation is not set up", no prompt. This explains the missing row. Press Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Escape is two-stage only when a filter has been typed (first clears the filter, then closes); with nothing typed one Escape closes the menu.
  * ./client-with-image allows you to get an image back of what you did, so can be useful for speeding things up
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the System submenu with six rows and no Hibernate, the closed menu, the mouse-opened menu, and the swapon/remove output
  * If unsuccessful
  ** A missing or extra row, or `omarchy-hibernation-remove` prompting or erroring
covers: default/omarchy/omarchy-menu.jsonc (system.*), default/hypr/bindings/utilities.lua (SUPER+ESCAPE), bin/omarchy-hibernation-available, bin/omarchy-hibernation-remove
merged-from: 24:system-menu-power-entries-listed

### reboot-from-system-menu-full-boot-chain   [VM-OK] [SLOW]
description: Reboot from the System menu closes windows, clears the reboot-required flag and walks the whole boot chain — the branded Limine menu (Omarchy kernel, fallback, Snapshots submenu; second row the default), the Plymouth passphrase prompt refusing one wrong try, SDDM autologin with no password screen — back to a clean desktop with the previous session's files intact.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter) and type `omarchy-state set reboot-required; ls ~/.local/state/omarchy/reboot-required; touch ~/before-reboot-marker; journalctl --list-boots | wc -l; cat /etc/sddm.conf.d/autologin.conf; loginctl show-session $XDG_SESSION_ID -p Service -p Type` — the flag file is listed (the bar may show a reboot indicator); note the boot count; `[Autologin] User=prime Session=omarchy.desktop`; `Service=sddm-autologin`, `Type=wayland`. Press Super+Enter again so a second window is open.
  ** If `omarchy-state` is missing on this build, note "absent on this build" and continue without the flag.
  * Press Super+Escape and click Reboot with the mouse. An OSD "Rebooting" shows, all windows close within a second and the screen goes dark about two seconds later.
  ** Do not pick Suspend or Hibernate. Screenshot continuously from the moment the screen goes dark; the bootloader menu is brief.
  * As soon as the firmware splash is gone press Down once per screenshot to stop the countdown. The Limine menu shows a green "Omarchy Bootloader" heading on a dark (Tokyo Night) background, entries with a countdown: one containing "Omarchy" (linux-omarchy), a "fallback" entry, and a Snapshots entry. Record every entry name and which row was highlighted — the second row is the configured default (`default_entry: 2`).
  ** Limine waits only about five seconds; if it boots on its own that is acceptable — note it and skip the next step.
  * Highlight Snapshots and press Enter: the submenu lists snapshots with a date and description, never more than 6 (on a freshly minted disk it may be empty or the entry absent — record it, do not fail). Press Escape: the main menu reappears unchanged. Highlight the first Omarchy entry and press Enter.
  ** Never press Enter on a snapshot row.
  * The Plymouth splash appears: logo, lock icon, entry box (only the logo until the first key). Type `wrongpass` and Enter — dots appear while typing, then clear, and the same lock/entry prompt returns; no text console, no scrolling log, no emergency shell. Type `prime` and Enter — a thin progress bar replaces the box.
  ** Exactly ONE wrong passphrase. Three wrong tries drop to an emergency shell and the disk is lost.
  * The desktop must appear **without** any SDDM password screen (autologin; log in with `prime` only if a greeter shows — and report it). Open a terminal and type `journalctl --list-boots | wc -l; ls ~/.local/state/omarchy/reboot-required 2>&1; ls ~/before-reboot-marker && rm ~/before-reboot-marker; uptime -s` — the count is one higher, the flag is "No such file or directory", the marker is listed (a clean shutdown preserved it) and the boot time is from just now.
  * Type `cat /proc/cmdline; journalctl -b -u sddm --no-pager | grep -i autologin | head -3` — the cmdline contains `cryptdevice=`, `quiet splash` and `initramfs_async=0`; an autologin line for `prime` from this boot. Press Ctrl+D; the desktop is back with no windows.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Limine keys: Up/Down move, Enter opens Snapshots or boots, Esc goes back. If the menu never appears (straight to the splash), report it with the screenshots.
  * Plymouth: the passphrase box is under the logo and is typed blind; keystrokes typed before the lock/entry graphic appears are discarded — if unsure, type the passphrase + Enter again after 5 s. If a text line "Please enter passphrase for disk" appears instead of the graphic, type `prime` to recover and report that screenshot as a failure. A `[rootfs ]#` or "emergency shell" prompt is a failure — capture it.
  * The serial console shows essentially nothing during boot; the screenshots are the evidence. The reboot takes 1–2 minutes: never sleep more than 5 s.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the flag file, boot count, autologin.conf and `Service=sddm-autologin`; the "Rebooting" OSD with the windows closing; the Limine menu with the green "Omarchy Bootloader" heading and the entry list (Omarchy, fallback, Snapshots; second row highlighted); the Snapshots submenu (or the note that it was empty/absent) and the main menu after Escape; the Plymouth box with dots; the prompt returned after the wrong passphrase; the progress bar; the desktop with no greeter in between, the higher boot count, the flag gone, the marker listed, the cmdline line and the sddm autologin journal line
  ** The mouse button was used to click Reboot
  * If unsuccessful
  ** No reboot within 30 s after the windows close, a missing/unbranded Limine menu, a Limine hash-mismatch warning, a Snapshots submenu that cannot be exited, an unthemed text passphrase prompt, an emergency shell, a boot on the wrong passphrase, an SDDM password field, the flag surviving, or a boot that never reaches the desktop; `./client get-serial` and the last screenshot
covers: bin/omarchy-system-reboot, bin/omarchy-system-shutdown, bin/omarchy-state, bin/omarchy-hyprland-window-close-all, default/omarchy/omarchy-menu.jsonc:41 (system.reboot), default/limine/limine.conf, default/limine/default.conf, etc/limine-entry-tool.d/* (omarchy-defaults.conf), default/snapper/root, default/plymouth/omarchy.script, default/plymouth/omarchy.plymouth, etc/plymouth/plymouthd.conf, etc/mkinitcpio.conf.d/omarchy_hooks.conf (plymouth, encrypt), default/sddm/*, omarchy-iso orchestrator configure_login, install/config/increase-lockout-limit.sh (sddm-autologin), test/shell.d/system-power-test.sh, limine-defaults-test.sh, manual/02:3 (encryption), manual/04-navigation.md, manual/07:11, manual/48:5
merged-from: 24:reboot-full-boot-chain; 10:system-menu-reboot-and-resume; 52:system-reboot-from-menu-schedules-cleanly; 41:boot-menu-snapshots-submenu; 41:plymouth-luks-wrong-then-right-passphrase; 13:luks-wrong-passphrase-reprompts-at-boot; 41:boot-menu-shows-omarchy-entries; 42:resume-boot-luks-then-autologin

### shutdown-powers-off   [VM-OK]
description: Shutdown from the System menu shows its OSD, closes windows and powers the machine off within seconds, ending the session; the machine cannot be resumed afterwards, so this is the last action.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter) and a browser (Super+Shift+Enter). In the terminal type `echo SHUTDOWN-TEST-START | sudo tee /dev/ttyS0` (password `prime`).
  ** Chromium on 2 vCPU may raise Hyprland's "not responding" dialog while starting: click Wait, do not report a hang.
  * Press Super+Escape and click Shutdown with the mouse. An OSD "Shutting down" shows and the windows close.
  * Screenshot every 3–5 seconds. Within 30 seconds the screen is black or the guest is gone (screenshots stop changing or the client reports no machine).
  * Read `./client get-serial`: SHUTDOWN-TEST-START is present (the serial channel worked); note any power-down text if the console shows it.
  * This is the last action; the machine cannot be resumed afterwards — end the session with `stop`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If a desktop is still visible after 30 seconds, type `systemctl list-jobs | sudo tee /dev/ttyS0` in a terminal and report it.
  * Do not pick Suspend: it is one-way in this guest and is not this test.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the "Shutting down" OSD, the closed windows, the black/absent screen within 30 s, and the serial dump containing SHUTDOWN-TEST-START
  ** The mouse button was used to click Shutdown
  * If unsuccessful
  ** A desktop or TTY still visible after 60 s and the list-jobs serial output
covers: bin/omarchy-system-shutdown, default/systemd/faster-shutdown.conf, default/systemd/user@.service.d/faster-shutdown.conf, etc/systemd/system.conf.d/10-faster-shutdown.conf, test/shell.d/system-power-test.sh
merged-from: 24:shutdown-powers-off

### fast-shutdown-stuck-unit-reboots-quickly   [VM-OK] [SLOW]
description: A reboot with a deliberately stuck user process still completes within seconds because Omarchy caps systemd stop timeouts at 5 s instead of the default 1 min 30 s.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter and type `systemd-run --user --unit=stuck-test bash -c 'trap "" TERM; sleep 600'` Enter.
  ** A transient unit that ignores SIGTERM is now running.
  * Press Super+Escape and click Reboot with the mouse; screenshot every 3–5 s.
  ** From the "Rebooting" OSD to the boot menu must take well under 60 s (expect 10–25 s). Any "A stop job is running" line shows a 5 s limit, not 1 min 30 s.
  * Let Limine auto-boot. At the Plymouth passphrase prompt type `prime` Enter (typed blind) and reach the desktop (log in with `prime` only if a greeter shows).
  * Press Super+Enter and type `journalctl -b -1 --no-pager | grep -iE 'stop job|stuck-test' | tail -3` Enter → the stuck unit was killed after ~5 s.
  * Press Ctrl+D; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The screenshot cadence is the timer: count screenshots between the OSD and the boot menu.
  * `./client get-serial` after the reboot shows the shutdown log with timestamps if the journal line is unclear; the boot itself writes nothing to serial.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot sequence from the OSD to the boot menu proving the elapsed time; the LUKS prompt; the journal line showing the 5 s kill; the desktop as before
  * If unsuccessful
  ** Screenshot of a "1min 30s" stop job or a reboot exceeding 60 s, plus the serial log
covers: etc/systemd/system.conf.d/10-faster-shutdown.conf, etc/systemd/system/user@.service.d/10-faster-shutdown.conf, default/systemd/faster-shutdown.conf, default/systemd/user@.service.d/faster-shutdown.conf
merged-from: 41:fast-shutdown-timeouts

### post-boot-hook-fires-after-reboot   [VM-OK] [SLOW]
description: Hyprland's autostart runs `omarchy-hook post-boot` shortly after login, so a user-installed post-boot hook runs on the next boot and is visible as a toast; the hook is removed afterwards.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `printf '#!/bin/bash\ndate > ~/post-boot-ran\nomarchy-notification-send "post-boot hook ran"\n' > /tmp/pb.sh && omarchy hook install post-boot /tmp/pb.sh`; expected `Installed post-boot hook: …/post-boot.d/pb.sh`.
  * Type `omarchy hook post-boot && cat ~/post-boot-ran && rm ~/post-boot-ran`; a toast `post-boot hook ran` appears and a date prints (the manual run works).
  * Press Super+Escape (the System menu) and click Reboot with the mouse. Answer the LUKS passphrase `prime` (typed blind); log in as `prime`/`prime` only if a login screen appears.
  * Screenshot every 3 s for the first 20 s after the desktop appears; a toast `post-boot hook ran` must show.
  * Open a terminal and type `cat ~/post-boot-ran`; a date from the last two minutes.
  * Type `rm -r ~/.config/omarchy/hooks/post-boot.d ~/post-boot-ran` to restore the stock state. Press Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The reboot takes 1–2 minutes including the passphrase prompt; keep taking screenshots, never sleep long.
  * The toast is transient — the 3 s cadence after login matters. `./client-with-image` helps catch it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the install line, the manual-run toast and date, the toast after login, and the fresh date in `~/post-boot-ran`; the hook directory removed at the end
  * If unsuccessful
  ** The post-login desktop with no toast, the absent/old marker file, and `./client get-serial`
covers: default/hypr/autostart.lua:13; bin/omarchy-hook; bin/omarchy-hook-install
merged-from: 20:hook-post-boot-fires-after-reboot

### passwordless-sudo-grant-cleared-by-reboot   [VM-OK] [SLOW]
description: A passwordless sudo grant never survives a reboot: systemd-tmpfiles removes every generated `99-omarchy-nopasswd-*` grant at boot while leaving Omarchy's other sudoers drop-ins intact.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `omarchy-sudo-passwordless 120`; confirm Yes and enter the password `prime`. Expect `Passwordless sudo has been ENABLED. It will automatically disable in 120 minutes.`
  * Run `ls /etc/sudoers.d/` and confirm both `99-omarchy-nopasswd-prime` and `omarchy-tzupdate` are listed. Run `sudo -k; sudo -n true; echo "exit=$?"` → `exit=0` (no password needed now).
  * Press Super+Escape (the System menu) and click Reboot with the mouse. Answer the LUKS passphrase `prime` (typed blind); log in with `prime` only if a greeter appears.
  * Open a terminal and run `ls /etc/sudoers.d/` → `99-omarchy-nopasswd-prime` must be gone and `omarchy-tzupdate` must still be present.
  * Run `sudo -k; sudo -n true; echo "exit=$?"` → `exit=1` (a password is required again). Press Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The reboot takes one to two minutes; take screenshots of the boot splash and the desktop returning.
  * `omarchy-tzupdate` is the control file proving the cleanup only targets `99-omarchy-nopasswd-*`.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of both files and `exit=0` before the reboot, the reboot itself, and after login only `omarchy-tzupdate` remaining with `sudo -n true` giving `exit=1`
  * If unsuccessful
  ** Screenshot of `99-omarchy-nopasswd-prime` surviving the reboot or `omarchy-tzupdate` missing
  ** Output of `omarchy-version`
covers: etc/tmpfiles.d/omarchy-nopasswd-sudo.conf, bin/omarchy-sudo-passwordless, bin/omarchy-system-reboot; test/shell.d/nopasswd-sudo-expiry-test.sh, system-power-test.sh; manual/48-security.md
merged-from: 52:passwordless-sudo-grant-cleared-by-reboot

### snapshot-create-list-retention-and-unknown-action   [VM-OK]
description: `omarchy-snapshot create` (also `omarchy snapshot create`) takes a numbered Snapper snapshot of root labelled with the Omarchy version and the boot menu picks it up, retention keeps at most five, the bare command prints usage — and an unknown action must be refused with the same usage line on stderr and a non-zero exit (03-INTENDED-BEHAVIOUR #4, DEFECT: HEAD prints nothing and exits 0; the test asserts the intended refusal and records the silent success as the failure).
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter) and type `sudo snapper list-configs; sudo snapper -c root list | sudo tee /dev/ttyS0` (password `prime`) — the configs (typically only `root`) and the numbered rows (a fresh disk usually has only `0 | single | current`); note the highest number.
  ** `snapper list` is wide: read it with `./client get-serial`, or append `| cut -c1-100`.
  * Type `omarchy-snapshot; echo "exit=$?"` — `Usage: omarchy-snapshot <create|restore>` and `exit=1`.
  * Type `omarchy snapshot create; echo "exit=$?"` — green `Create system snapshot`, one snapper line with the new number, `Snapshots can be selected during boot.`, `exit=0`.
  ** A yellow `No Snapper configs found, so no snapshot was created.` means the disk shipped unconfigured: type the command it prints (`sudo bash -euo pipefail "/usr/share/omarchy/install/config/snapper.sh"`), rerun, and record it as an environment finding.
  * Type `omarchy-version; sudo snapper -c root list | tail -n 3` — a new row of type `single`, cleanup `number`, whose description equals the version just printed (e.g. `4.0.2-1`, or `dev (<hash>)` on a dev checkout); no row has cleanup `timeline`.
  * Type `sudo grep -E '^(TIMELINE_CREATE|NUMBER_LIMIT|NUMBER_LIMIT_IMPORTANT|NUMBER_CLEANUP)=' /etc/snapper/configs/root; systemctl is-enabled snapper-timeline.timer snapper-cleanup.timer limine-snapper-sync.service; grep MAX_SNAPSHOT_ENTRIES /etc/limine-entry-tool.d/omarchy-defaults.conf; sudo grep -c snapshot /boot/limine.conf` — `TIMELINE_CREATE="no"`, `NUMBER_LIMIT="5"`, `NUMBER_LIMIT_IMPORTANT="5"`, `NUMBER_CLEANUP="yes"`; `disabled`, `enabled`, `enabled`; `MAX_SNAPSHOT_ENTRIES=6`; a count greater than 0 (the boot menu picked the snapshot up).
  * Type `for i in 1 2 3 4 5 6; do omarchy-snapshot create; done` and wait until six "Create system snapshot" blocks have printed (a second or two each; screenshot while it runs, do not interrupt). Then `sudo snapper -c root list | sudo tee /dev/ttyS0` — at most 5 numbered rows besides `0 | current`, and the lowest number created in this run is gone.
  * Unhappy path: type `omarchy-snapshot bogus; echo "exit=$?"`, then `omarchy snapshot bogus; echo "exit=$?"` — intended: `Usage: omarchy-snapshot <create|restore>` (on stderr) and `exit=1` for both. Capture exactly what appears.
  ** Known defect at HEAD (03-INTENDED-BEHAVIOUR #4): no output and `exit=0`. If that is what you see, the step FAILS — report the silent acceptance as the defect, with both screenshots. Either way, `sudo snapper -c root list | tail -n 1` must show the row count unchanged: nothing was created or deleted.
  * Round trip: delete each snapshot this run created with `sudo snapper -c root delete <n>` (the numbers seen above), then `sudo snapper -c root list | tail -n 2` — the list is back to what it was. Press Super+W.
  ** Or end the session with `stop`; a left-over snapshot only adds entries to the boot menu.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The loop is one line; type it exactly, including the semicolons.
  * The `bogus` step is a negative-path check whose artefact is whether the usage text is printed and the exit is non-zero; silence with `exit=0` is the recorded defect, not a pass.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the usage line with `exit=1`; of "Create system snapshot" … "Snapshots can be selected during boot." with `exit=0`; of the new `number` row whose description matches `omarchy-version`; of the config values, timer states, `MAX_SNAPSHOT_ENTRIES=6` and the non-zero grep count
  ** Screenshot of six create blocks and the serial capture of `snapper list` with ≤5 numbered rows and a gap where the oldest was pruned
  ** Screenshot of `Usage: omarchy-snapshot <create|restore>` with `exit=1` for both `bogus` invocations, an unchanged row count, and the list restored
  * If unsuccessful
  ** The `bogus` invocations printing nothing with `exit=0` (the HEAD defect — capture both screenshots and `omarchy-version`), a snapshot created or deleted by the bogus call, or a crash from the router
  ** The failing command's output (yellow "No Snapper configs found" persisting after configuration, a snapper error, `exit=127` — record `pacman -Q snapper`), a `timeline` row or timer enabled, 6+ numbered rows (add `systemctl status snapper-cleanup.timer`); `systemctl status limine-snapper-sync.service` when the grep count is 0; output of `omarchy-version`
covers: bin/omarchy-snapshot (create, cleanup number, case with no default); bin/omarchy router; default/snapper/root; install/config/snapper.sh; etc/limine-entry-tool.d/omarchy-defaults.conf (MAX_SNAPSHOT_ENTRIES=6); manual/47-system-snapshots.md (47:3); test/shell.d/snapshot-create-test.sh, snapper-test.sh, snapper-timeline-leak-test.sh, version-test.sh
merged-from: 24:snapshot-create-list-and-retention; 13:snapshot-create-cli; 52:snapshot-create-lists-number-snapshot; 13:snapshot-retention-keeps-five; 20:snapshot-create-and-unknown-subcommand; 13:snapshot-unknown-action-silent-exit

### snapshot-create-fails-loudly-without-config   [VM-OK]
description: When Snapper is installed but has no configuration, `omarchy-snapshot create` fails with an explanation and a non-zero exit instead of silently passing for a backup; the configuration is restored afterwards and create works again.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter.
  * Temporarily hide the Snapper root config: `sudo mv /etc/snapper/configs/root /root/snapper-root.bak && sudo cp /etc/conf.d/snapper /root/snapper-conf.bak && sudo sed -i 's/^SNAPPER_CONFIGS=.*/SNAPPER_CONFIGS=""/' /etc/conf.d/snapper` (password `prime`).
  * Run `sudo snapper list-configs` → only the header, no `root` row.
  * Run `omarchy-snapshot create; echo "exit=$?"` → yellow `No Snapper configs found, so no snapshot was created.` and `Configure Snapper with: sudo bash -euo pipefail "/usr/share/omarchy/install/config/snapper.sh"`, with `exit=1`.
  * Restore immediately: `sudo mv /root/snapper-root.bak /etc/snapper/configs/root && sudo cp /root/snapper-conf.bak /etc/conf.d/snapper && sudo snapper list-configs` → the `root` row is back.
  * Run `omarchy-snapshot create` once more to confirm it works again (`Create system snapshot` … `Snapshots can be selected during boot.`). Round trip: `sudo snapper -c root list | tail -n 1` shows the new number; `sudo snapper -c root delete <that number>`. Press Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Always run the restore step, even if an earlier step fails; the config is needed by updates and by the boot menu snapshot entries.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of `list-configs` empty, the exact `No Snapper configs found…` message with the configure hint and `exit=1`, then `root` restored and a successful snapshot
  * If unsuccessful
  ** Screenshot of `Create system snapshot` printed with no config (silent false success) or of the restore failing
  ** Output of `omarchy-version`
covers: bin/omarchy-snapshot; test/shell.d/snapshot-create-test.sh; manual/47-system-snapshots.md
merged-from: 52:snapshot-create-fails-loudly-without-config

### snapshot-boot-from-limine-menu-read-only   [VM-OK] [SLOW]
description: A snapshot taken by `omarchy-snapshot` can be booted read-only from the Limine Snapshots menu — the desktop offers to restore it, root-filesystem changes made after the snapshot are absent — and the next normal boot returns to the live system exactly as left; the recovery entry point the manual promises for a bad update.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter). Type `sudo touch /etc/before-snapshot` (password `prime`), then `omarchy-snapshot create`, then `sudo rm /etc/before-snapshot; sudo touch /etc/rollback-probe; omarchy-version; sudo snapper -c root list | tail -n 1` — note the version and the new snapshot number N. Take screenshots for ~10 s so the boot menu can sync.
  ** `No Snapper configs found, so no snapshot was created.` means the minted disk has snapper unconfigured — record it and stop; the test does not apply.
  * Press Super+Escape and click Reboot with the mouse. When the screen goes dark press Down every second, screenshotting, until the "Omarchy Bootloader" menu is visible.
  ** The menu is on screen only ~5 s unless a key is pressed; if the passphrase prompt shows instead, type `prime`, reach the desktop and reboot again.
  * Move to the `Snapshots` entry, press Enter and screenshot the list: the entry for N shows a date and the version you noted. Highlight it, press Enter, type `prime` at the passphrase prompt (log in with `prime` only if a greeter appears).
  ** If the desktop does not load, press Ctrl+Alt+F3 and log in as prime/prime on the text console.
  * On the desktop, within ~30 s, a critical notification `Restore this snapshot now!` (app "Snapshot detected!") must appear. Do not click it.
  ** If it does not appear, open a terminal and type `limine-snapper-restore --notify`; note whether it prints "You are not in a snapshot." and report.
  * Open a terminal and type `ls /etc/before-snapshot /etc/rollback-probe; findmnt -no OPTIONS /; sudo btrfs property get / ro; grep -o 'snapshots/[0-9]*/snapshot' /proc/cmdline; touch /usr/test` — `before-snapshot` exists, `rollback-probe` is "No such file or directory" (the snapshot predates it), the mount options contain `.snapshots/N/snapshot` and `ro`, `ro=true`, the cmdline names the snapshot, and touch says "Read-only file system".
  * Reboot again (Super+Escape → Reboot, or `systemctl reboot` on the console), let Limine auto-boot without touching keys, type `prime`. On the desktop type `ls /etc/before-snapshot /etc/rollback-probe; findmnt -no OPTIONS /` — `before-snapshot` missing, `rollback-probe` present, `subvol=/@` again: the live root is back exactly as left.
  * Restore: `sudo rm /etc/rollback-probe; sudo snapper -c root delete N`. Press Super+W. (Or end with `stop`.)
  ** Do not run `omarchy snapshot restore` here: that makes the rollback permanent and is its own test.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Limine keys: Up/Down move, Enter opens `Snapshots` or boots, Esc goes back. The Snapshots entries come from limine-snapper-sync and carry the snapper description.
  * `./client-with-image` helps catch the notification early; critical toasts persist until dismissed.
  * Two reboots with LUKS prompts (typed blind): budget about four minutes; never sleep more than 5 s.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the snapshot creation output; the Limine menu and the expanded Snapshots list with N's date and version; the "Restore this snapshot now!" notification on the desktop
  ** Screenshot of the terminal in the snapshot boot showing `before-snapshot` present, the probe absent, `.snapshots/N/snapshot` + `ro`, `ro=true`, the cmdline, and the read-only touch error
  ** Screenshot after the normal boot: the probe present, `before-snapshot` gone and `subvol=/@`
  * If unsuccessful
  ** No `Snapshots` entry, a Limine hash warning, a hung boot (`./client get-serial`), no notification (plus the by-hand `--notify` output), a writable snapshot boot, the probe present inside the snapshot, or `before-snapshot` present after the normal boot
covers: bin/omarchy-snapshot, default/limine/limine.conf, etc/limine-entry-tool.d/omarchy-defaults.conf (BOOT_ORDER Snapshots, MAX_SNAPSHOT_ENTRIES), install/config/snapper.sh (limine-snapper-sync), default/snapper/root, etc/mkinitcpio.conf.d/omarchy_hooks.conf (btrfs-overlayfs), limine-snapper-restore --notify, manual/47:5-17, manual/30-updates.md (Rolling back bad updates), docs/update-process.md (snapshot step)
merged-from: 24:snapshot-boot-from-limine-menu; 13:snapshot-boot-into-snapshot-shows-restore-notification; 12:update-rollback-boot-snapshot

### snapshot-restore-from-booted-snapshot   [VM-OK] [SLOW]
description: Clicking the snapshot notification on a snapshot boot restores the root filesystem and leaves /home alone, so a broken update is rolled back without losing personal files; the disk is replaced, so the session ends with `stop`.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter. Type `omarchy-snapshot create` (password `prime`), then `sudo touch /etc/broken-after-snapshot`, then `touch ~/keep-me`.
  * Reboot (Super+Escape → click Reboot), press Down at the Limine menu, open `Snapshots`, boot the snapshot you just made, type `prime`.
  * When `Restore this snapshot now!` appears, click it with the mouse. A terminal must open running the restore; enter `prime` in the polkit password dialog if one appears.
  ** If nothing opens within 10 s, open a terminal, type `omarchy-snapshot restore` (password `prime`) and report that the click path failed.
  * Answer the restore tool's prompts (confirm the currently booted snapshot). Screenshot every prompt. It must end with a success message.
  * Reboot as the tool suggests (or Super+Escape → Reboot), let Limine auto-boot, type `prime`.
  * Open a terminal and type `ls /etc/broken-after-snapshot ~/keep-me; grep -o 'subvol=/@[^ ]*' /proc/cmdline`: the /etc file is MISSING, `~/keep-me` is PRESENT, and the root is `subvol=/@`.
  * Reboot once more, press Down at Limine and screenshot the menu: a backup/previous-state entry added by the restore is expected. Boot normally with `prime`. The root filesystem has been replaced: end the session with `stop`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The restore tool is `limine-snapper-sync --restore` (method `replace`); its prompts are plain text — read before answering.
  * Three reboots with blind LUKS prompts: keep screenshots flowing, never sleep more than 5 s.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the clicked notification, the restore terminal (and polkit dialog), and its finish message
  ** Screenshot after reboot: /etc file gone, home file kept, `subvol=/@`
  ** Screenshot of the Limine menu with the backup entry
  * If unsuccessful
  ** The restore tool's error text (hash mismatch, ESP space, "restore blocked"), a Limine warning screen, or a root still on a `.snapshots` path
covers: manual/47:11-17; bin/omarchy-snapshot restore; limine-snapper-restore; btrfs @home layout
merged-from: 13:snapshot-restore-from-booted-snapshot

### snapshot-restore-picker-cancel-from-normal-boot   [VM-OK]
description: Running `omarchy snapshot restore` from a normal boot, or naming a snapshot that does not exist, never rewrites the root: it offers a picker or says there is nothing to restore, and cancelling changes nothing (the real restore is `snapshot-restore-from-booted-snapshot`).
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter) and type `findmnt -no OPTIONS /; sudo snapper -c root list | tail -n 2` (password `prime`) — the options contain `subvol=/@`; note whether any numbered snapshots exist (none on a fresh disk is the "nothing to restore" case).
  * Type `omarchy snapshot restore` (enter `prime` if sudo asks). A text UI from `limine-snapper-restore` appears: either a snapshot picker/confirmation or a message that the system is not booted from a snapshot / nothing is available. Screenshot it and describe its options; capture the wording verbatim.
  * Do NOT confirm any restore. If it takes a number, type an invalid one such as `9999` first and capture the message. Then cancel with Escape / Ctrl+C / its Quit option (answer No to any confirmation) until the prompt returns; type `echo "exit=$?"` and record it.
  ** If a picker highlights a snapshot, the safe key is Escape; never press Enter on a highlighted row.
  * Type `sudo limine-snapper-sync --restore-kernels 9999; echo "exit=$?"` — an error and a non-zero exit for the nonexistent ID.
  * Type `findmnt -no OPTIONS /; grep -o 'subvol=/@[^ ]*' /proc/cmdline; hostname; omarchy version; sudo snapper -c root list | tail -n 2` — still `subvol=/@`, the same version and the same snapshot list: nothing changed. Press Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The restore tool is upstream `limine-snapper-sync`; wording varies by version — capture it verbatim.
  * ./client-with-image allows you to get an image back of what you did, so can be useful for speeding things up
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the message or picker from `omarchy snapshot restore`, of the invalid-number message if offered, and of the cancel with its exit code
  ** Screenshot of the error + non-zero exit for ID 9999 and of the unchanged mount options, version and snapshot list afterwards
  * If unsuccessful
  ** `limine-snapper-restore: command not found`, a restore proceeding without confirmation, a traceback, or a changed root/boot entry or snapshot list
covers: bin/omarchy-snapshot:46-48 (restore); limine-snapper-restore (is_snapshot); manual/47-system-snapshots.md (47:11)
merged-from: 24:snapshot-restore-picker-cancel; 13:snapshot-restore-outside-snapshot-lists-or-refuses; 20:snapshot-restore-opens-and-cancels

### direct-boot-toggle-skips-limine-and-back   [VM-OK] [SLOW]
description: Setup → Direct Boot adds an `Omarchy` EFI entry pointing at the UKI (first in BootOrder) so the firmware boots straight to the passphrase prompt without Limine, a second run offers to remove it, declining either prompt changes nothing, and after removal the Limine menu is back.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter) and type `sudo efibootmgr` (password `prime`) — entries include `Limine`, none labelled `Omarchy` (`sudo efibootmgr | grep -c Omarchy` → 0); note `BootOrder`.
  * Open the Omarchy Menu (Super+Space) → Setup → Direct Boot with the mouse. At `Setup direct boot (so snapshot booting must be done via bios)?` choose **No**: the terminal ends with "Done!" and nothing else; `sudo efibootmgr` is unchanged.
  ** gum confirm: Left/Right or Tab picks Yes/No, Enter confirms.
  * Repeat Setup → Direct Boot and choose **Yes** — `Creating EFI boot entry for omarchy_linux-omarchy.efi`, the efibootmgr listing, "Done!". Type `sudo efibootmgr -v | grep Omarchy; sudo efibootmgr | grep BootOrder` — one `Boot000X* Omarchy … File(\EFI\Linux\omarchy_linux-omarchy.efi)` line, and its number is now first in `BootOrder`.
  * Reboot (Super+Escape → Reboot) screenshotting every 2–3 s: the "Omarchy Bootloader" menu must NOT appear — the passphrase prompt comes straight after the firmware. Type `prime` (blind).
  ** If Limine does appear, the firmware did not keep the variable (harness NVRAM caveat) — record it and continue.
  * Type `sudo efibootmgr` and note whether the Omarchy entry survived. Open Setup → Direct Boot again: it must ask `Disable direct boot (remove Omarchy EFI entry)?` — choose **No** first: the entry stays and nothing is printed. Reopen and choose **Yes** → `Removing EFI boot entry 000X`, "Done!". `sudo efibootmgr | grep -c Omarchy` → 0.
  ** If it offers to set up instead (entry lost), choose No and report the caveat.
  * Reboot once more; the Limine menu must show again (press Down to hold it, screenshot), then boot the Omarchy entry and type `prime`. The desktop must return exactly as left.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * OVMF reports bios_vendor `EDK II`, so the AMI/Apple refusal does not trigger here; "American Megatrends firmware may not safely support custom EFI entries" means the guest firmware is not the expected OVMF — report it.
  * Always finish with the entry removed; a disk saved with it present bypasses Limine and its Snapshots menu.
  * Two reboots: budget ~4 minutes; screenshot continuously through each boot.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of `efibootmgr` before (no Omarchy), after No (unchanged), after Yes (Omarchy entry with the UKI path, first in BootOrder), after the disable-No (still present) and after the disable-Yes (gone)
  ** Boot screenshots: no Limine menu after enable; the Limine menu back after disable; the desktop as left
  * If unsuccessful
  ** Script errors ("not booted in UEFI mode", "efibootmgr is not available", "No Omarchy UKI found in /boot/EFI/Linux/", an efibootmgr failure), or the entry surviving/vanishing contrary to the step; `sudo efibootmgr -v`
covers: manual/47:23-25; bin/omarchy-setup-direct-boot; default/omarchy/omarchy-menu.jsonc setup.direct-boot; omarchy-iso _register_limine_efi_entry
merged-from: 13:direct-boot-toggle-skips-limine; 24:setup-direct-boot-toggle; 42:setup-direct-boot-efi-entry

### refresh-limine-bootloader   [VM-OK] [SLOW]
description: `omarchy-refresh-limine` resets the boot menu config from the Omarchy default, keeps a backup of the user's edited file, rebuilds the entries, and the machine still boots.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `echo '# user tweak' | sudo tee -a /boot/limine.conf` (password `prime`).
  * Type `omarchy-refresh-limine` → `Resetting limine config`, then `limine-update` listing entries and `limine-snapper-sync`, no errors.
  * Type `sudo tail -1 /boot/limine.conf; sudo tail -1 /boot/limine.conf.bak` → a normal config line, then `# user tweak` (the tweak survived only in the backup).
  * Type `systemctl reboot`; screenshot continuously and press Down as soon as the Limine menu appears to hold it: the rebuilt menu lists the Omarchy entry (and Snapshots).
  * Boot the Omarchy entry, enter `prime` at the passphrase (blind), log in only if asked; the desktop returns exactly as left.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If `limine-update` prints an error, stop and report it; do not reboot a machine whose bootloader update failed.
  * The reboot takes 1–2 minutes; never sleep more than 5 s.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Terminal with the reset output and the two tail lines; boot screenshots with the Limine menu; the desktop after the reboot
  * If unsuccessful
  ** The `limine-update` error text; the boot screen if the reboot fails; `./client get-serial`
covers: bin/omarchy-refresh-limine, default/limine/limine.conf
merged-from: 21:refresh-limine-bootloader

### limine-scan-on-single-os-finds-nothing   [VM-PARTIAL]
description: `limine-scan` (the dual-boot chapter's way to add Windows) runs harmlessly on a single-OS machine: it finds no foreign bootloader and leaves the boot menu as it was. Only that half is checkable here; adding a real second OS is not.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `sudo cp /boot/limine.conf /tmp/limine.before` (password `prime`).
  * Type `sudo limine-scan`. Read each prompt; it reports the EFI entries found (only Omarchy/Limine here) and either offers nothing or asks to add — answer No/quit to any add. Screenshot the output.
  * Type `sudo diff /tmp/limine.before /boot/limine.conf && echo UNCHANGED`: `UNCHANGED` (record any diff).
  * Reboot (Super+Escape → click Reboot), press Down at Limine and screenshot: only the Omarchy entry (and Snapshots) — no foreign entry was added.
  * Boot the Omarchy entry with `prime` (blind); the desktop returns exactly as left.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * `limine-scan` is upstream limine-entry-tool; `FIND_BOOTLOADERS=yes` already adds foreign loaders on `limine-update`, so it may report entries as already present.
  * Skipped part: adding a real Windows/second OS — the guest has none.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of limine-scan's output, `UNCHANGED`, and the Limine menu after the reboot with only the Omarchy and Snapshots entries
  * If unsuccessful
  ** limine-scan erroring, altering limine.conf on No, or a broken boot menu; `./client get-serial`
covers: manual/50:35-37; etc/limine-entry-tool.d/omarchy-defaults.conf FIND_BOOTLOADERS
merged-from: 13:limine-scan-on-single-os-finds-nothing

### drive-password-change-and-back-at-boot   [VM-OK] [SLOW]
description: Update → Password → Drive Encryption changes the LUKS passphrase after verifying the current one — the next boot refuses the old and takes the new, the user password is untouched — and the user changes it back to `prime`, proven without a second reboot by `cryptsetup --test-passphrase`.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Omarchy Menu (Super+Space) → Update → Password → Drive Encryption with the mouse. A floating terminal shows a masked input `New encryption password`.
  * Type `newpass1` Enter, then `newpass1` Enter at `Confirm new encryption password`. It prints `Changing full-disk encryption password for /dev/vdaN`, may ask `[sudo] password for prime:` (type `prime`), then cryptsetup asks `Enter passphrase to be changed:` — type `prime` Enter. After a few seconds: `● Done! Press any key to close...`. Press a key.
  ** Password fields echo nothing (count the bullets in gum's masked inputs); cryptsetup's prompt is plain text without gum styling; argon2id makes each change take ~2–4 s.
  * Open a terminal (Super+Enter) and type `D=$(sudo blkid -t TYPE=crypto_LUKS -o device | head -1); printf newpass1 | sudo cryptsetup open --test-passphrase --key-file - $D; echo "new=$?"; printf prime | sudo cryptsetup open --test-passphrase --key-file - $D; echo "old=$?"` — `new=0`, `old=2` (No key available with this passphrase).
  * Press Super+Escape → click Reboot. At the Plymouth box type `prime` Enter — rejected, the box clears (this is the ONE wrong try allowed). Type `newpass1` Enter — the progress bar appears and the system boots to the desktop (autologin; the user password is unchanged — log in with `prime` only if a greeter shows).
  * Lock with Super+Ctrl+L and unlock with `prime`: the user password is unaffected.
  ** The lock screen blanks 5 s after the last input; just type — the first character wakes it and enters the field.
  * Change back: open a terminal and type `omarchy-drive-password`: new `prime`, confirm `prime`, then `newpass1` at `Enter passphrase to be changed:` — no error.
  * Type `D=$(sudo blkid -t TYPE=crypto_LUKS -o device | head -1); printf prime | sudo cryptsetup open --test-passphrase --key-file - $D; echo "prime=$?"; printf newpass1 | sudo cryptsetup open --test-passphrase --key-file - $D; echo "new=$?"` — `prime=0` (unlocks again without another reboot), `new=2`. Press Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The passphrase MUST be `prime` again at the end or the disk cannot be resumed; if anything fails midway, repeat the change-back step before stopping, and state which passphrase the disk ended with.
  * Screenshot after every Enter to catch the refusal at boot; the boot prompt is typed blind and early keys may be discarded — wait for the lock/entry graphic before typing.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the two masked inputs, the "Changing full-disk encryption password" line and cryptsetup prompt, Done; `new=0` / `old=2`
  ** Boot screenshots: Plymouth rejecting `prime` then accepting `newpass1`; the desktop; the lock screen unlocked with `prime`
  ** Screenshot of the change-back run and `prime=0` / `new=2` afterwards
  * If unsuccessful
  ** cryptsetup error text ("No key available with this passphrase", "No encrypted drives available."), the old passphrase still unlocking, a boot that unlocks with neither passphrase (`./client get-serial`), or the final test refusing `prime` — state which passphrase the disk ended with; `sudo cryptsetup luksDump $D | grep -A3 Keyslots`
covers: manual/48:13; bin/omarchy-drive-password; bin/omarchy-drive-select; default/plymouth/omarchy.script; default/omarchy/omarchy-menu.jsonc (update.password.drive); test/shell.d/drive-password-test.sh
merged-from: 24:drive-password-change-and-back; 13:drive-encryption-password-change-and-back; 42:drive-password-change-and-revert

### drive-password-rejects-bad-input   [VM-OK]
description: The Drive Encryption tool refuses an empty or mismatched new passphrase, a wrong current passphrase and an Escape, each without touching the LUKS key — `prime` still unlocks and the container is intact.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Omarchy Menu (Super+Space) → Update → Password → Drive Encryption with the mouse. At `New encryption password` press Enter with nothing typed — `Password cannot be empty.` and `Failed (exit code 1)!`; the floating terminal closes on the next key — screenshot quickly.
  * Reopen it; type `abc123` Enter, then `abc124` Enter at `Confirm new encryption password` — `Passwords do not match.` and `Failed (exit code 1)!`.
  * Open a terminal (Super+Enter) and type `omarchy-drive-password`: `abc123` Enter, `abc123` Enter; at `Enter passphrase to be changed:` type `wrongpass` Enter (password `prime` first if sudo asks) — cryptsetup prints `No key available with this passphrase.`. Press Ctrl+C if it offers a retry.
  * Type `omarchy-drive-password` once more and press Esc at the first prompt: it exits quietly with no change.
  * Type `D=$(sudo blkid -t TYPE=crypto_LUKS -o device | head -1); printf prime | sudo cryptsetup open --test-passphrase --key-file - $D && echo PRIME-OK; sudo cryptsetup luksDump $D | grep -m1 -i version; omarchy-drive-info /dev/vda` — `PRIME-OK`, a `Version:` line (the device is still a valid LUKS container), and one line like `/dev/vda (40G) - … [vfat(/boot), crypto_LUKS]`. Press Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * gum password fields show nothing while typing — count the bullets to be sure the typed text landed. The cryptsetup prompt for the existing passphrase comes after the confirmation, in plain text.
  * Nothing here should change the key; `PRIME-OK` is the round-trip proof, so no reboot is needed. If it is missing, report which passphrase the disk ended with and end the session with `stop`.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of `Password cannot be empty.` and `Passwords do not match.` (each with `Failed (exit code 1)!`), of `No key available with this passphrase.`, and of the quiet Esc exit
  ** Screenshot of `PRIME-OK`, the LUKS version line and the drive-info line
  * If unsuccessful
  ** cryptsetup invoked on the empty/mismatch path, the tool proceeding past bad input, a `luksChangeKey` error, a traceback, or `prime` no longer unlocking
covers: bin/omarchy-drive-password (validation and cryptsetup failure path); bin/omarchy-drive-info; bin/omarchy-drive-select; default/omarchy/omarchy-menu.jsonc update.password.drive; test/shell.d/drive-password-test.sh; manual/48-security.md (48:13)
merged-from: 24:drive-password-rejects-bad-input; 13:drive-encryption-password-rejects-bad-input; 51:drive-password-rejects-then-changes

### user-password-change-keeps-disk-password   [VM-OK] [SLOW]
description: Update → Password → User changes only the login/sudo password — the lock screen takes the new one, a wrong current password is refused — while the disk still unlocks with `prime` on reboot; the user then changes it back.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Omarchy Menu (Super+Space) → Update → Password → User with the mouse. At `Current password:` type `prime`; at `New password:` and `Retype new password:` type `newuserpw1`. Expect `passwd: password updated successfully` and "Done!". Press a key.
  * Lock with Super+Ctrl+L. Type `prime` Enter: stays locked (`Authentication failed`). Type `newuserpw1` Enter: the desktop returns.
  ** The lock screen blanks 5 s after the last input; keystrokes still reach the password box (the first character wakes it).
  * Reboot (Super+Escape → click Reboot). At the disk prompt type `prime` (blind): it must unlock; the desktop appears (autologin, no login step).
  * Unhappy path: open Update → Password → User again and type `wrong` at `Current password:`: `passwd: Authentication token manipulation error` (or "Authentication failure") and "Failed (exit code 1)!". Press a key.
  * Change back: Update → Password → User, current `newuserpw1`, new `prime` twice, "Done!". Lock with Super+Ctrl+L and unlock with `prime` — exactly as it started.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * `passwd` echoes nothing; screenshot after each Enter.
  * Only one wrong lock-screen try is made here; faillock (`deny=10`, shared with sudo) is far from tripping.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of "password updated successfully"; the lock screen refusing `prime` and accepting `newuserpw1`
  ** Boot screenshot showing `prime` still unlocking the disk and the desktop appearing
  ** Screenshot of the wrong-current-password failure and the final unlock with `prime`
  * If unsuccessful
  ** The disk prompt refusing `prime` after the change (coupled passwords), or passwd errors on valid input
covers: manual/48:13; omarchy-menu.jsonc update.password.user (passwd); PAM system-auth
merged-from: 13:user-password-change-keeps-disk-password

### factory-reset-confirm-cancel-and-wrong-passphrase   [VM-OK]
description: Setup → Reset Computer explains what it erases and refuses to stage a wipe unless the user types exactly `reset` and proves the disk passphrase; a mistyped word, an Escape, or a cancelled passphrase step leaves the system booting as before (a cancelled passphrase step still scrubs the `@factory` baseline, so the session ends with `stop`).
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Omarchy Menu (Super+Space) → Setup → Reset Computer with the mouse. A floating terminal opens; enter the sudo password `prime` when asked.
  ** If a yellow `This machine has no factory snapshot to reset to.` appears with `Reinstall from the Omarchy ISO to make this machine resettable.` and `● Failed (exit code 1)!`, press a key, record it as a mint/ISO gap and stop here.
  * The bold red `Reset this computer to factory state?` screen lists what is erased (all user accounts and everything in /home; all packages and system changes since installation; machine identity), says `The next boot asks for a new user, exactly like a fresh install.` and shows a `Type 'reset' to continue` input. Screenshot.
  * Unhappy path 1: type `RESET` and press Enter → `Error: Reset not confirmed.` then `Failed (exit code 1)! Press any key to close...`. Press a key.
  * Reopen Setup → Reset Computer (`prime`); at the input press Escape → the terminal ends with `Failed (exit code 1)!`, nothing staged. Press a key.
  * Verify nothing changed: open a terminal (Super+Enter) and type `sudo ls /var/lib/omarchy/provisioning/; sudo btrfs subvolume list / | grep -c omarchy-reset; systemctl is-enabled limine-snapper-sync.service` → no `pending`/`wipe-pending`, `0`, `enabled` (the runtime mask is only applied after confirmation).
  * Unhappy path 2 — cancel after confirming: reopen Setup → Reset Computer, `prime`, type `reset` Enter. After the grey lines `Cloning the factory snapshot` … `Removing account credentials from the factory system` it asks `Confirm your disk encryption passphrase to authorize the re-key.` with a `Passphrase>` prompt. Type `wrong` Enter → red `That passphrase does not unlock /dev/… Try again.`. Press Esc: the script exits with `Failed (exit code 1)!`. Press a key.
  ** Quirk: by this point the script has already scrubbed the `@factory` baseline in place and runtime-masked `limine-snapper-sync` until reboot. Harmless on this disposable disk, but the session must end with `stop` — never `save` this disk. Never type the correct passphrase here: that stages the wipe (the separate test `factory-reset-full-cycle-new-owner`).
  * Type `sudo ls /var/lib/omarchy/provisioning/; DEV=$(findmnt -no SOURCE / | sed 's/\[.*//'); sudo mkdir -p /mnt/top; sudo mount -o subvolid=5 $DEV /mnt/top; ls /mnt/top; sudo umount /mnt/top` → still no `pending`/`wipe-pending`; list the top-level subvolumes and report any `@omarchy-reset-next` or `@omarchy-old-*` left behind (the cleanup trap should have removed the staged clone).
  * Reboot (Super+Escape → Reboot), type `prime` (blind) at the passphrase prompt: the same desktop and user return — no first-boot wizard. End the session with `stop`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * gum input: Esc cancels. The Reset entry only appears because root is btrfs; the presentation wrapper waits for a key press before closing the floating terminal.
  * Version skew: Reset Computer is a HEAD-era row; if it is absent from Setup on this build, report "absent on this build" with `omarchy version`.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the confirmation screen text (or the no-snapshot screen), of `Error: Reset not confirmed.` with exit code 1, and of the Escape exit
  ** Screenshot of the provisioning dir, the `0` subvolume count and `enabled` unchanged after the two refusals
  ** Screenshot of `That passphrase does not unlock … Try again.` and the cancelled run; the provisioning dir and top-level listing afterwards; the normal desktop after the reboot
  * If unsuccessful
  ** Any staging line after a wrong word or Escape, `Reset staged.` after a refused passphrase, a subvolume named `@omarchy-reset-next` in the listing, or the first-boot wizard appearing after the reboot
covers: manual/48:17-19; bin/omarchy-system-factory-reset (confirm_reset, self-elevation, stage_luks_rekey, cleanup trap); default/omarchy/omarchy-menu.jsonc setup.reset; bin/omarchy-show-done; test/shell.d/factory-reset-accounts-test.sh
merged-from: 42:factory-reset-confirm-cancel; 24:factory-reset-cancel-at-confirmation; 13:factory-reset-rejects-wrong-confirmation-and-passphrase

### factory-reset-full-cycle-new-owner   [VM-OK] [SLOW]
description: Setup → Reset Computer returns an in-use encrypted machine to first-boot provisioning: staging clones the factory snapshot, re-keys the disk and rebuilds boot; the reboot wipes the old root with no passphrase prompt; the first-boot form creates a new owner who lands on the desktop with a fresh identity, no trace of the seller, and a disk that unlocks only with the new owner's password. At the ten-minute budget edge (8–12 min on 2 vCPU); destroys the disk — end with `stop`, never `save`.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter) and type `hostname; cat /etc/machine-id; touch ~/seller-file` — note the hostname (expect `omarchy`) and the machine-id. Open the Omarchy Menu (Super+Space) → Setup → Reset Computer with the mouse; sudo password `prime`; at `Type 'reset' to continue` type `reset`, Enter.
  * At `Confirm your disk encryption passphrase to authorize the re-key.` → `Passphrase>`: unhappy path first — type `nope`, Enter → `That passphrase does not unlock … Try again.`; then type `prime`, Enter.
  * Watch the grey progress lines: `Cloning the factory snapshot`, `Scrubbing machine identity from the factory system`, `Removing account credentials from the factory system`, `Recreating the hibernation swapfile in the factory system`, `Rebuilding boot files from the factory system (this can take a minute)`, `Activating the factory system`. Screenshot every 5 s; 2–5 minutes.
  * At `Reset staged. The wipe finishes on the next boot.` / `Reboot to complete the reset?` choose **Reboot later** → `Do not keep using this machine — changes made now will be lost.` Screenshot, then reboot deliberately: `systemctl reboot` in a terminal.
  * Let Limine auto-boot. The boot must NOT ask for a LUKS passphrase (throwaway auto-unlock key) — record whether one appears. `./client get-serial` should show `factory-wipe: … factory wipe complete`. tty1 then shows the provisioning greeter: animated logo, `Beautiful, Fun & Agentic Linux by DHH`, `Press Return to Start Setup`. Press Enter.
  ** The form runs on tty1 with a dark palette; if it looks garbled wait 2–3 s — it redraws after the virtio-gpu console resize. If the machine parks at the `Omarchy Bootloader` menu instead of booting, screenshot it (that is a defect) and select the Omarchy entry with the arrows and Enter.
  * Walk the wizard: `Let's setup your keyboard...` → leave `English (US)`, Enter. `Let's setup your user account...`: `Username>` `owner`, Enter; `Password>` `owner`, Enter; `Confirm>` `other`, Enter → `Passwords didn't match!`; re-enter `owner` / `owner`. `Full name>` `Second Owner`; `Email address>` Enter (skip); `Hostname>` `reset-box`. `Let's set your timezone...` → Enter on the preselected zone (or type `UTC` and Enter if it is a filter). The review table shows Keyboard, Username `owner`, Password `*****`, Full name, Email `[Skipped]`, Hostname `reset-box`, Timezone → `Does this look right?` choose **No, change it** once, then **Yes**.
  * `Setting up your machine` with a progress bar and rotating tips runs 2–5 minutes (offline Node unpack, LUKS re-key, UKI rebuild). Screenshot every 5 s. It hands straight to the desktop (autologin) with no login prompt.
  * On the new desktop open a terminal and type `whoami; hostname; cat /etc/machine-id; id; ls /home; id prime; ls ~/seller-file; ls /var/lib/omarchy/provisioning/; ls /etc/sudoers.d/00-omarchy-wheel` → `owner`, `reset-box`, a **different** machine-id, `owner` in `wheel`, only `owner` in /home, `no such user` for prime, `No such file` for the seller file, no `pending`/`wipe-pending`/`luks-key`, the wheel drop-in present. Then `D=$(sudo blkid -t TYPE=crypto_LUKS -o device | head -1); sudo cryptsetup luksDump $D | grep -E '^\s+[0-9]+: luks2'; grep -c cryptkey /proc/cmdline; sudo btrfs subvolume list /` (password `owner`) → exactly one keyslot; `0`; no `@omarchy-old-*` and `@factory` retained.
  * If budget remains, reboot (Super+Escape → Reboot): a passphrase prompt MUST appear; type `prime` → refused (the one wrong try); type `owner` → the desktop returns. The machine now belongs to the new owner: end the session with `stop` (it cannot return to `prime`; never `save`).
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The whole cycle is 8–12 minutes on this guest: never sleep more than 5 s between screenshots and keep going.
  * On failure the first-boot screen shows `Setup hit an error (details in /var/log/omarchy-provision-owner.log)` with `Try again` / `Drop to console`: screenshot it, choose `Try again` once; if it fails again choose `Drop to console`, type `cat /var/log/omarchy-provision-owner.log | tee /dev/ttyS0` and report via `./client get-serial`.
  * `This machine has no factory snapshot to reset to.` on the minted disk is a mint/ISO gap — report it as such. Reset Computer is a HEAD-era row; if absent from Setup, report "absent on this build".
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the passphrase rejection, the staging lines, `Reset staged.` and the `Reboot later` warning
  ** Screenshots of the passphrase-less boot (serial excerpt with "factory wipe complete"), the first-boot greeter, the `Passwords didn't match!` notice, the review table, the `Setting up your machine` bar
  ** Screenshot of the new desktop and of `whoami`/`hostname`/machine-id/`id`, no `prime`, the seller file gone, the single LUKS keyslot with no `cryptkey` on the cmdline, and the subvolume list without old roots
  ** If run: boot screenshots with the passphrase prompt present, `prime` refused, `owner` accepted
  * If unsuccessful
  ** Screenshot of where it stopped (an `Error:` from the reset, a limine-update/hash-mismatch message, the Limine menu, a LUKS prompt that should not exist, the retry screen with the log), `prime` still existing, or no passphrase prompt on the final boot (disk still auto-unlocking); `journalctl -b | grep factory-wipe | sudo tee /dev/ttyS0` and `./client get-serial`
covers: manual/48:17-19; manual/02:25 (first-boot half); bin/omarchy-system-factory-reset; bin/omarchy-system-factory-reset-finish; install/provisioning/*.service; bin/omarchy-provision-owner (greeter, forms, rekey_luks, configure_login, limine_entries_stale); bin/omarchy-provision-user; install/provisioning/setup-form.sh; install/config/snapper.sh; default/limine/limine.conf; omarchy-iso test/integration.d/factory-reset-test.sh; test/shell.d/factory-reset-accounts-test.sh, setup-form-test.sh, provision-user-test.sh
merged-from: 42:factory-reset-full-cycle; 13:factory-reset-hands-machine-to-new-owner; 24:factory-reset-full-cycle

### factory-reset-first-boot-form-validation   [VM-OK] [SLOW]
description: The first-boot owner form that a factory reset hands the machine to rejects reserved or malformed usernames, blank or mismatched passwords and bad hostnames with clear notices, and Esc, Ctrl+C and "No, change it" behave as escape hatches rather than traps; the new owner still lands on the desktop. Destroys the disk — end with `stop`, never `save`.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Stage a reset as in `factory-reset-full-cycle-new-owner`: Omarchy Menu (Super+Space) → Setup → Reset Computer with the mouse, sudo `prime`, type `reset`, `Passphrase>` `prime`, wait for `Reset staged.` and choose `Reboot now`. Let Limine auto-boot (no passphrase prompt is expected) and press Enter at the console greeter (`Press Return to Start Setup`).
  ** `This machine has no factory snapshot to reset to.` is a mint/ISO gap — report it and stop. If the form looks garbled, wait 2–3 s for the virtio-gpu console redraw.
  * Keyboard step: press Esc — nothing precedes it, so the picker simply reappears. Press Enter for `English (US)`.
  * `Username>`: type `root` → `Username is reserved for system`; `Bad Name` → `Username must be alphanumeric with no spaces`; then `newowner` is accepted.
  * `Password>`: press Enter twice → `Your password can't be blank!`; `abc` / `xyz` → `Passwords didn't match!`; then `owner-pass-1` twice.
  * At `Full name>` press Ctrl+C once → `Reboot this machine?` with `Yes, reboot` / `No, keep setting up`; choose `No, keep setting up`, then press Enter twice to skip name and email.
  * `Hostname>`: type `-bad-` → `Hostname must be 1-63 letters, digits, or dashes…`; press Enter on empty → the default `omarchy`. At the timezone step press Esc — the form unwinds to the keyboard step; go through it again quickly (Enter, `newowner`, `owner-pass-1` twice, Enter ×2, Enter, pick a timezone with Enter).
  * At `Does this look right?` choose `No, change it` once (the form restarts), run through again and choose `Yes`. `Setting up your machine` runs 2–5 minutes (screenshot every 5 s); on the desktop open a terminal and type `whoami; hostname` → `newowner`, `omarchy`. The machine now belongs to the new owner: end the session with `stop`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Validation notices flash for about a second — screenshot immediately after Enter (`./client-with-image` helps).
  * Budget 8–10 minutes including the staging and the final provisioning; be brisk in the repeated form passes and never sleep more than 5 s.
  * On `Setup hit an error` choose `Try again` once; if it fails again, `Drop to console`, `cat /var/log/omarchy-provision-owner.log | tee /dev/ttyS0`, and report via `./client get-serial`.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of each rejection notice (reserved, alphanumeric, blank, mismatch, hostname)
  ** Screenshot of the Ctrl+C reboot confirm declined, Esc unwinding to the keyboard step, and "No, change it" restarting the form
  ** Desktop as `newowner` with hostname `omarchy`
  * If unsuccessful
  ** An invalid value accepted, Ctrl+C rebooting without asking, `Setup hit an error` with the log, or a skipped step; `./client get-serial`
covers: install/provisioning/setup-form.sh; bin/omarchy-provision-owner (keyboard_form, user_form, confirm_form, confirm_reboot); manual/02:25; manual/48:17
merged-from: 13:factory-reset-first-boot-form-validation

### factory-snapshot-present-and-reset-refuses-without-it   [VM-OK]
description: Every ISO install leaves a read-only `@factory` snapshot without install-time secrets — the baseline Reset Computer clones — and on a machine whose baseline is gone Reset Computer explains that and points to a reinstall instead of wiping anything; the baseline is deleted here, so the session ends with `stop`.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter). Type `sudo btrfs subvolume list / | grep -E 'path @'` (password `prime`) → lines for `@`, `@home`, `@log`, `@pkg` and `@factory`.
  * Type `DEV=$(findmnt -no SOURCE / | sed 's/\[.*//'); echo $DEV; sudo mkdir -p /mnt/top && sudo mount -o subvolid=5 $DEV /mnt/top && ls /mnt/top` → `@ @factory @home @log @pkg` (an `@omarchy-*` entry means a reset was once staged — there must be none).
  * Type `sudo btrfs property get -ts /mnt/top/@factory ro; sudo touch /mnt/top/@factory/x; echo "exit=$?"` → `ro=true` and `touch: cannot touch … Read-only file system`, `exit=1`.
  * Type `sudo ls /mnt/top/@factory/var/lib/omarchy/provisioning/ /mnt/top/@factory/etc/omarchy/ /mnt/top/@factory/etc/tailscale 2>&1; sudo ls /mnt/top/@factory/home/` → `packages` (and maybe `groups`); no `luks-key`, `provisioning.key` or `authorized_keys`; the tailscale dir absent; `prime` present (a normal install's snapshot still has the install user — the reset scrubs it later).
  * Unhappy path — remove the baseline on this throwaway disk: `sudo btrfs subvolume delete /mnt/top/@factory && ls /mnt/top && sudo umount /mnt/top` → the listing without `@factory`.
  * Type `omarchy-system-factory-reset; echo "rc=$?"` (it self-elevates: sudo password `prime`) → `This machine has no factory snapshot to reset to.`, the explanation paragraph, `Reinstall from the Omarchy ISO to make this machine resettable.`, and `rc=1`. No `Type 'reset'` prompt appears.
  * Open the Omarchy Menu (Super+Space) → Setup: the Reset Computer entry is still listed (it is gated on btrfs, not on the snapshot); click it → the same refusal in a floating terminal ending `Failed (exit code 1)!`. Press a key.
  * The disk no longer has its baseline: end the session with `stop`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * `findmnt -no SOURCE /` prints something like `/dev/mapper/<name>[/@]`; the sed strips the subvolume suffix.
  * Version skew: Reset Computer is a HEAD-era row; if absent from Setup on this build, report "absent on this build" with `omarchy version` and keep the CLI result.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the subvolume list including `@factory` and of the top-level listing
  ** Screenshot of `ro=true` and the read-only `touch` failure; of the scrubbed provisioning directory (no luks-key/provisioning.key/authorized_keys)
  ** Screenshot of the top level without `@factory`, the refusal text with `rc=1`, and the same refusal from the menu entry
  * If unsuccessful
  ** The listing missing `@factory` before deletion, `ro=false`, a secret present in the snapshot, or a `Type 'reset'` confirmation prompt appearing despite the missing snapshot
covers: omarchy-iso orchestrator create_factory_snapshot, FACTORY_SCRUB_PATHS, test_provisioning_state.py CreateFactorySnapshotTest; bin/omarchy-system-factory-reset (require_factory_snapshot); manual/48-security (reset pointer in manual/02)
merged-from: 42:factory-snapshot-present-and-scrubbed; 42:factory-reset-refuses-without-factory-snapshot

### boot-chain-and-snapper-config-invariants   [VM-OK]
description: The installer's boot-chain invariants still hold on the running system — Limine config and UKI, machine-id-bound entry, EFI order, pacman hooks unmasked, headers matching the kernel — and Snapper is configured from Omarchy's template with the timeline disabled and `/.snapshots` a real subvolume, so the snapshot menu and rollbacks work.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter). Everything under /boot needs `sudo` (password `prime`): /boot is mounted with umask=0077.
  * Type `sudo ls -la /boot/EFI/Linux/ /boot/EFI/limine/` → `omarchy_linux-omarchy.efi` (tens of MB) and `limine_x64.efi`.
  * Type `sudo grep -E '^/|machine-id|cryptdevice|interface_branding|default_entry' /boot/limine.conf; cat /etc/machine-id` → an `/Omarchy` entry carrying `machine-id=<32 hex>` equal to `/etc/machine-id`, `cryptdevice=`, `interface_branding: Omarchy Bootloader`, `default_entry: 2`.
  * Type `cat /etc/kernel/cmdline; grep -E 'ESP_PATH|KERNEL_CMDLINE' /etc/default/limine; sudo grep -c '@@CMDLINE@@' /etc/default/limine` → both hold `root=` and `cryptdevice=`; `ESP_PATH="/boot"`; the unhappy-path count of the unexpanded placeholder is `0`.
  * Type `sudo efibootmgr | head -6` → `BootOrder:` starts with the `Limine` entry's number.
  * Type `ls -la /etc/pacman.d/hooks/; ls /usr/lib/modules/*/build/include/config/kernel.release && uname -r` → `99-omarchy-limine.hook` present, no `*.omarchy-backup`, `90-mkinitcpio-install.hook` a regular file (shipped by limine-mkinitcpio-hook, never a symlink to /dev/null); the headers' release equals the running kernel.
  * Snapper: type `sudo diff /usr/share/omarchy/default/snapper/root /etc/snapper/configs/root && echo same; cat /etc/conf.d/snapper; sudo btrfs subvolume show /.snapshots | head -2; grep -E 'NUMBER_LIMIT|TIMELINE_CREATE' /etc/snapper/configs/root` → `same`, `SNAPPER_CONFIGS="root"`, `.snapshots` is a subvolume, `TIMELINE_CREATE="no"` with the shipped `NUMBER_LIMIT`.
  * Unhappy path: `sudo snapper -c nosuch list 2>&1 | head -1` → an error that config `nosuch` does not exist; then `sudo snapper list | head -5` → at least the header (snapshots may or may not exist). Press Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Long outputs: redirect with `| sudo tee /dev/ttyS0` and read them with ./client get-serial.
  * `snapper list` may need a second or two on first use (dbus activation). Nothing here changes the machine.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots (or serial) of the UKI and limine binary listing, the limine.conf lines with the matching machine-id, the cmdline/defaults with the `0` placeholder count, `BootOrder` starting with Limine, the hooks directory without backups/masks, and the headers matching `uname -r`
  ** Screenshot of `same`, the conf.d line, the `.snapshots` subvolume info, the retention keys and the `nosuch` error
  * If unsuccessful
  ** The command output showing the missing file, mismatched machine-id, a `/dev/null` symlink hook, the diff output or the `btrfs subvolume show` error
covers: omarchy-iso orchestrator _configure_limine_boot, _write_limine_defaults, finalize_limine_boot (snapper config asserted), validate_boot, _assert_boot_hooks_restored, _validate_kernel_headers; default/limine/{default,limine}.conf; etc/limine-entry-tool.d/omarchy-uki.conf; test_kernel_selection.py; install/config/snapper.sh; default/snapper/root; bin/omarchy-system-factory-reset-finish (repair_snapshots_dir)
merged-from: 42:boot-config-limine-uki-present; 42:snapper-retention-config

### shipped-system-defaults-in-place   [VM-OK]
description: The one-time root config leaves and the packaged defaults the maintainers pin as contracts are present on an installed system — Chromium first-run prefs, Yaru icon links, the powerprofilesctl shebang, SSH keepalive with user override, PAM PATH, browser policy dirs, lock-screen PAM, the sudoers drop-ins, hardened CUPS, the kernel headers, Limine boot defaults, ufw, the plocate drop-in, the Bluetooth agent condition and the crash watcher.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter); every command here is read-only.
  * Type `cat /usr/lib/chromium/initial_preferences; readlink /usr/share/icons/Yaru/scalable/actions/go-previous-symbolic.svg; head -1 /usr/bin/powerprofilesctl` → JSON with `"require_eula":false` and `"color_scheme":0`; `/usr/share/icons/Adwaita/symbolic/actions/go-previous-symbolic.svg`; `#!/bin/python3`.
  * Type `cat /etc/ssh/ssh_config.d/20-omarchy-keepalive.conf; ssh -G localhost | grep -iE 'serveralive|connecttimeout'; ssh -o ServerAliveInterval=5 -G localhost | grep -i serveraliveinterval` → `ServerAliveInterval 15`, `ServerAliveCountMax 3`, `ConnectTimeout 10` effective; the override path prints `5` (user options win).
  * Type `grep '^PATH' /etc/security/pam_env.conf; stat -c '%U %a %n' /etc/chromium /etc/chromium/policies /etc/chromium/policies/managed; ls /etc/chromium/policies/managed` → the line containing `@{HOME}/.local/share/mise/shims:@{HOME}/.local/bin`; `root 755` ×3; `color.json`.
  * Type `ls /etc/pam.d/omarchy-lock-password; grep -c gnome_keyring /etc/pam.d/sddm; ls /etc/sudoers.d/; sudo grep -E '^%wheel' /etc/sudoers` (password `prime`) → the file present; `0`; the four shipped drop-ins `omarchy-dns omarchy-passwd-tries omarchy-theme-browser omarchy-tzupdate` and no `00-omarchy-wheel` (only first-boot provisioning writes that); `%wheel ALL=(ALL:ALL) ALL` uncommented.
  * Type `grep -E '^(SystemGroup|PeerCred)' /etc/cups/cups-files.conf; pacman -Q cups cups-filters system-config-printer cups-pk-helper; pacman -Q cups-browsed cups-pdf 2>&1; systemctl is-active cups` → exactly `SystemGroup cups-browsed sys root` and `PeerCred on`; four packages; two `was not found`; `active`. Then press Super+Alt+Space, type `print`, open "Print Settings" — it opens without an authentication error; close it with Super+W.
  * Type `pacman -Q linux-omarchy linux-omarchy-headers; cat /etc/limine-entry-tool.d/omarchy-defaults.conf; grep -o initramfs_async=0 /proc/cmdline` → both packages at the same version; `KERNEL_CMDLINE[default]+=" initramfs_async=0"`, `BOOT_ORDER="linux-t2, linux-omarchy, linux-omarchy-*, *, *fallback, Snapshots"`; the cmdline match.
  * Type `systemctl is-enabled ufw; sudo ufw status | head -1; systemctl cat plocate-updatedb.service | grep -E 'ExecStart|ConditionACPower'; systemctl --user cat bt-agent.service | grep Condition; systemctl --user is-enabled omarchy-crash-watch.service; ls /usr/share/libalpm/hooks/ | grep -c omarchy` → `enabled`, `Status: active`; an empty `ExecStart=` then `ExecStart=/usr/bin/updatedb --prune-bind-mounts=no --add-prunepaths=/.snapshots` and `ConditionACPower=true`; `ConditionPathIsDirectory=/sys/class/bluetooth`; `enabled`; `3`. Press Super+W.
  ** The minted ISO is 4.0.2; if a file predates a HEAD change, report its actual content and `omarchy-version` rather than failing silently.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Each command group's output is short; one screenshot per group. Long outputs: `| sudo tee /dev/ttyS0` and ./client get-serial.
  * GTK apps such as Print Settings render oversized at 1× (`GDK_SCALE=2` fixed): expected, not a bug.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of every value listed above, including the `5` override, the sudoers `%wheel` line, Print Settings open, and each command's output exactly as listed
  * If unsuccessful
  ** The command output showing the missing file, wrong owner/mode, the wrong shebang, or the differing line(s) and the file or package they came from
covers: install/config/{theme-system,browser-policy,fix-powerprofilesctl-shebang,ssh-command-path,ssh-keepalive,lockscreen-pam,firewall}.sh, install/helpers/browser-policy.sh, install/login/sddm.sh, bin/omarchy-provision-owner (00-omarchy-wheel absence on a normal install), etc/sudoers.d/*, etc/cups/*, etc/limine-entry-tool.d/omarchy-defaults.conf, default/systemd/**; test/shell.d/cups-hardening-test.sh, kernel-headers-migration-test.sh, limine-defaults-test.sh, firewall-config-test.sh, locate-test.sh (drop-in), bluetooth-test.sh (bt-agent condition), crash-capture-test.sh (unit enabled), config-test.sh (alpm hooks, package defaults)
merged-from: 42:system-config-dropins-present; 51:packaged-system-defaults-in-place

### locate-indexes-and-prunes-snapshots   [VM-OK]
description: After Omarchy's `updatedb` run, `locate` finds a new file, excludes `/.snapshots` (so snapshot copies never pollute results), and `/etc/updatedb.conf` is left untouched.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter) and type `sudo stat -c '%a %U %Y' /etc/updatedb.conf; sudo sha256sum /etc/updatedb.conf; mkdir -p ~/locate-probe && touch ~/locate-probe/omarchy-locate-probe-file` (password `prime`).
  * Type `sudo /usr/bin/updatedb --prune-bind-mounts=no --add-prunepaths=/.snapshots` (about 20 s; screenshot while it runs).
  * Type `locate omarchy-locate-probe-file; locate -c /.snapshots/; sudo ls /.snapshots | head -2` — the probe path, `0`, and existing snapshot directories (if any).
  ** `locate -c` counts matches; a non-zero count under `/.snapshots` is the failure.
  * Type `sudo stat -c '%a %U %Y' /etc/updatedb.conf; sudo sha256sum /etc/updatedb.conf` — identical to the first reading.
  * Type `sudo systemctl start plocate-updatedb.service; systemctl status plocate-updatedb.service | head -6` — the unit ran the same `updatedb` command line and exited 0.
  * Type `rm -r ~/locate-probe` — the probe is gone. Press Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The unit's status shows `ExecStart=/usr/bin/updatedb --prune-bind-mounts=no --add-prunepaths=/.snapshots`.
  * A fresh mint may have no snapshots in `/.snapshots`; the `0` count still proves the prune path is configured.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The probe found; `0` snapshot entries; `updatedb.conf` unchanged (same mode/owner/mtime/hash); the unit succeeding
  * If unsuccessful
  ** The probe missing, snapshot paths indexed, `updatedb.conf` changed, or the unit failing
covers: test/shell.d/locate-test.sh; default/systemd/system/plocate-updatedb.service.d/10-omarchy.conf; install/post-install/localdb.sh; manual/47-system-snapshots.md
merged-from: 51:locate-indexes-and-prunes-snapshots

### hardware-gated-entries-hidden-in-vm   [VM-OK]
description: Laptop- and hardware-gated controls (battery widget, lid, touchpad, laptop display, fingerprint, webcam, hibernate) are absent in this QEMU guest and the detection helpers say why — the absence path for every power and hardware feature the VM lacks.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Screenshot the bar: no battery widget (the power, bluetooth and agents icons are also absent by design).
  * Open the Omarchy Menu with Super+Space, click Trigger → Hardware: no `Laptop Display`, `Mirror Display`, `Touchpad`, `Hybrid GPU`.
  ** A fully guarded submenu vanishes from its parent and its route opens "Nothing here yet" — screenshot whichever you see. `Touchscreen` may still show (the QEMU USB tablet can register as a tablet): report what is there.
  * Trigger → Toggle: no `Battery Percentage`. Trigger → Capture → Screen Record: no webcam variant. Setup → Security: no `Fingerprint`, but `Fido2`, `SSHD`, `Passwordless Sudo` present. Press Escape until the menu closes.
  * Press Super+Escape: the System menu has no `Hibernate` (Screensaver, Lock, Suspend, Logout, Reboot, Shutdown only). Press Esc. Do not select Suspend.
  * Open a terminal with Super+Enter and type `for c in laptop fingerprint webcam touchpad touchscreen; do omarchy-hw-$c; echo "$c=$?"; done; ls /sys/class/power_supply/` — every `=1` and an empty power_supply listing (record `touchscreen=` either way if the menu showed a Touchscreen row). Press Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Guarded entries are removed, not greyed; compare against the menu's full list if unsure. Guards paint from the previous evaluation — reopen a submenu twice before asserting a row's absence.
  * Escape is two-stage when a filter has been typed; Backspace on an empty filter goes back a level.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the bar without a battery widget, of each submenu with the gated entries absent (or "Nothing here yet"), of the System menu without Hibernate, and of the helper exit codes with the empty power_supply listing
  * If unsuccessful
  ** A laptop-only entry shown, a battery widget, or a helper returning 0 for hardware the guest lacks
covers: manual/49 (VM expectations gap); bin/omarchy-hw-laptop and hw-*; omarchy-menu.jsonc `when` guards; manual/44 (absence path)
merged-from: 13:vm-guest-laptop-only-entries-hidden

## Not runnable here

None. The slice's only `VM-NO` block, 13:update-creates-snapshot-before-packages, is a step inside
the full update run that G1's update tests drive and is listed under Moved; 24:factory-reset-full-cycle's
`VM-NO` was overruled by 01-FACTS (factory reset is testable in the guest, ~8–12 min on 2 vCPU, at
the budget edge) and merged into `factory-reset-full-cycle-new-owner` as `VM-OK` `SLOW`.

## Moved to other domains

- 10:notice-time-hotkey → D — Super+Ctrl+Alt+T is a notification toast story (DND, stacking), not power/boot.
- 20:ascii-render-and-skip → G2 — `omarchy ascii` CLI rendering/refusals; same story as 12:transcode-ascii-cli-and-reject there.
- 51:ascii-wordmark-and-refusals → G2 — same `omarchy ascii` story (row/width counts, Skipped line, unknown option).
- 23:install-service-nordvpn-no-reboot → F1 — an Install → Service story; the declined reboot is incidental.
- 25:toggle-nightlight-on-off → B — Trigger → Toggle / Super+Ctrl+N nightlight story; same as 10:nightlight-toggle-hotkey-status there (01-FACTS: the tint is visible in screendumps).
- 52:nightlight-toggle-status → B — same nightlight toggle story; its `VM-PARTIAL` is corrected by 01-FACTS (tint visible).
- 31:dev-gallery-open-and-walk-controls → D — shell dev-gallery panel controls; sibling of 31:dev-gallery-text-and-number-fields there.
- 31:dev-gallery-dropdowns-select-and-filter → D — dev-gallery Dropdown/SearchableDropdown story.
- 32:plugin-reserved-id-rejected-by-shell → H — shell plugin registry validation (reserved id, broken manifest); shell/plugin lifecycle lives there.
- 32:plugin-third-party-api-boundary → H — plugin shell-API security boundary; shell/security domain.
- 52:sudoless-docker-toggle-flags-reboot → H — Setup → Security → Sudoless Docker story; joins 25:sudoless-docker-enable-and-disable / 42:setup-sudoless-docker-toggle there (the reboot is declined, never taken).
- 13:update-creates-snapshot-before-packages → G1 — a proof line for the `Update → Omarchy` run ("Create system snapshot" precedes pacman output; the pre-update snapshot carries the old version); belongs in G1's update test rather than as a duplicate `VM-NO` appendix entry here.

## Dropped

None.

## Rerouted

- 31:dev-gallery-text-and-number-fields → D — D moved it here citing A2's two sibling dev-gallery blocks, but A2 had already moved those (31:dev-gallery-open-and-walk-controls, 31:dev-gallery-dropdowns-select-and-filter) to D in the first pass: the shell dev gallery is a panels/controls story with no power, boot or snapshot content, and all three blocks should be merged into one gallery test in D.

## Routing pass (incoming 4)

- 41:boot-menu-shows-omarchy-entries — folded into `reboot-from-system-menu-full-boot-chain` (branded green heading, Omarchy/fallback/Snapshots entries, second row default, `/proc/cmdline` `quiet splash` + `initramfs_async=0`).
- 42:resume-boot-luks-then-autologin — folded into `reboot-from-system-menu-full-boot-chain` (autologin.conf and `Service=sddm-autologin` before, no SDDM password screen after, sddm journal autologin line, `cryptdevice=` on the cmdline, discarded-early-keys hint).
- 13:factory-reset-first-boot-form-validation — new test `factory-reset-first-boot-form-validation` (distinct story from the full cycle; its validation passes do not fit the full cycle's budget).
- 31:dev-gallery-text-and-number-fields — rerouted to D (above).
- 03-INTENDED-BEHAVIOUR applied: #4 (`omarchy-snapshot <unknown>`, DEFECT) — `snapshot-create-list-retention-and-unknown-action` now asserts the intended usage-on-stderr + `exit=1` and records HEAD's silent `exit=0` as the failure to capture. #22 (LUKS never three wrong tries) and (a) (`Super+Escape` = System submenu) were already applied. #9 (`omarchy-upgrade-to-quattro`, UNCLEAR) touches no A2 test; the "never answer Yes" rule is carried by 02-PREAMBLE and G1's update tests.
