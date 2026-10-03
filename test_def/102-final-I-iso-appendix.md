# ISO appendix (installer, first boot, unattended, dual boot) — final tests

This domain holds every story that needs a **fresh ISO boot** instead of the resumed minted disk:
installer form validation (blank/mismatched/one-character passwords, username and hostname
refusals, the review loop, the disk picker with its encryption toggle, abort and retry), full
installs that prove what lands on disk (unencrypted → SDDM greeter, custom keyboard/hostname/
timezone/identity), the deferred "prepare for another owner" flow and its first-boot form errors,
the injected failure screen, the offline timezone fallback, unattended `cidata` installs (ssh key,
defer marker, tailscale), free-space install beside another OS, plus two hardware-bound `VM-NO`
blocks routed here (Battle.net needs a GPU; omarchy-mac needs Apple Silicon). 30 source blocks +
4 routed in (Try Omarchy from C; the Intel-Mac path and two fixture-disk installer paths from F1) →
0 runnable tests + 18 not-runnable entries (28 blocks) + 6 moved + 0 dropped. Routing pass: the
too-small free-space/partition-tool block folded into the free-space entry, the Intel-Mac path into
the Apple-hardware entry, and two new entries (8 GiB disk fails in the package phase; Try Omarchy
host apps). Verdicts applied from 03-INTENDED-BEHAVIOUR: #3 (unattended `ufw allow` is
CODE-INTENDED — already asserted, wording confirmed) and #1 (gpu-lib32 exit 1 is a DEFECT — the
Battle.net entry now asserts the intended no-op and records HEAD's `Failed (exit code 1)`). Notable merges: the
two password blocks (refusals + weak-password observation) into one; disk picker + encryption
toggle into one disk-step story; 13's `prepare-for-another-owner-ctrl-c` into 42's deferred
first-boot flow; 13's encrypted-vs-unencrypted login caveat into the interactive SDDM test (same
`configure_login` rule, now runnable from an ISO ticket); the four cidata blocks into two
(credentials + ssh key; defer marker); the two free-space/dual-boot blocks into one. Ten entries
carry `[VM-OK-from-ISO]` (they run as soon as a ticket does `./client start` without `--resume`,
like the existing `mint`); the other six each name the harness support they need. The six
`VM-OK` blocks about theme-install and web-app-install refusals are minted-disk stories that
belong to E and F1 and are moved, not rewritten.

## Tests

None. Every block in this slice is either an ISO/harness story (below) or a minted-disk story that
belongs to another domain (moved, below).

## Not runnable here

### iso-install-password-step-blank-mismatch-and-weak   [VM-NO] [VM-OK-from-ISO]
description: The installer's password step must refuse a blank password and a mismatched confirmation with a one-second notice and re-ask, never reaching the review table, while applying no length or strength rule — a one-character password (which becomes the user, root and LUKS passphrase) is accepted and shows as `Password *` in the review; recorded as a finding, not a crash. Not runnable on the resumed minted disk: needs an ISO ticket (`./client start` without `--resume`); no other harness change. No install is performed.
instruction: |
  <Instructions>
  From the desktop please do the following:
  (ISO ticket: start with `./client start` without `--resume`; "the desktop" here is the ISO's tty1. Nothing is written to disk in this test.)

  <ActionList>
  * Wait for the greeter (`Beautiful, Fun & Agentic Linux by DHH`, `Press Return to Start Install`) and press Enter; at `Select keyboard layout` press Enter (English (US)); at `Username>` type `tester`, Enter.
  * At `Password>` press Enter (blank), at `Confirm>` press Enter → the notice `Your password can't be blank!` shows for about a second, then `Password>` is asked again.
  * At `Password>` type `prime`, Enter; at `Confirm>` type `primx`, Enter → notice `Passwords didn't match!`, then `Password>` again.
  * At `Password>` type `a`, Enter; at `Confirm>` type `a`, Enter → **no notice**; the form advances to `Full name>`.
  ** This is the weak-password observation: a single character is accepted for user, root and LUKS. A pass means it was accepted; note it in the result as a finding. If a strength notice appears the behaviour changed — report its wording.
  * Press Enter at `Full name>` and `Email address>`, Enter at `Hostname>` (default), Enter at `Timezone` → the review table shows `Password *` (a single asterisk).
  * Choose `No, change it` → back to the keyboard step (`Let's setup your machine...`). Press Enter on the layout, `Username>` `tester`, `Password>` `prime`, `Confirm>` `prime` → advances to `Full name>` (a matching, non-blank password is accepted).
  * Press Escape at `Full name>` → the form unwinds to the keyboard step. Press Enter on the layout, then at `Username>` press Ctrl+C → `Aborted installation` / `You can retry later by running: ./.automated_script.sh` and a root prompt. End with `./client stop`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Notices show for ~1 s with a spinner; take the screenshot immediately after pressing Enter on the confirmation.
  * Ctrl+C means "abort to a root shell" in the user step (on the keyboard screen it means "prepare for another owner", on the disk confirm "toggle encryption").
  * gum confirm: Left/Right or Tab moves between the two buttons; Enter picks the highlighted one.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of `Your password can't be blank!`, `Passwords didn't match!`, the advance to `Full name>` after `a`/`a`, the review table with `Password *`, the unwind to the keyboard step and the abort text
  * If unsuccessful
  ** Screenshot of the review table appearing after a blank or mismatched password, a strength notice (report its wording), or the wizard crashing to a shell without the abort text; `./client get-serial`
covers: install/provisioning/setup-form.sh (omarchy_prompt_password — blank/mismatch only), configurator user_form/user_step/abort, test/shell.d/setup-form-test.sh, manual/02 (password is user + root + LUKS)
merged-from: 42:install-rejects-mismatched-and-blank-password; 42:install-accepts-weak-password

### iso-install-rejects-bad-username-and-hostname   [VM-NO] [VM-OK-from-ISO]
description: The installer must refuse malformed and reserved usernames and malformed hostnames with the documented one-second notices, default an empty hostname to `omarchy`, show every answer in the review table, and re-ask the whole form from empty fields after `No, change it`; no install is performed. Not runnable on the resumed minted disk: needs an ISO ticket (`./client start` without `--resume`); no other harness change.
instruction: |
  <Instructions>
  From the desktop please do the following:
  (ISO ticket: `./client start` without `--resume`; "the desktop" is the ISO's tty1. Nothing is written to disk.)

  <ActionList>
  * Greeter → Enter; `Select keyboard layout` → Enter (English (US)).
  * At `Username>` type `Not A Name`, Enter → `Username must be alphanumeric with no spaces`. Type `root`, Enter → `Username is reserved for system`. Type `sddm`, Enter → the same reserved notice. Type `9lives`, Enter → `Username must be alphanumeric with no spaces` (a name must start with a letter or `_`). Type `tester`, Enter → accepted.
  * `Password>` `prime`, `Confirm>` `prime`; `Full name>` type `Test Er`, Enter; `Email address>` type `t@example.org`, Enter.
  * At `Hostname>` type `-bad-`, Enter → `Hostname must be 1-63 letters, digits, or dashes, and cannot start or end with a dash`. Type `bad_host`, Enter → the same notice. Press Enter on the empty field → accepted (defaults to `omarchy`).
  * `Timezone` → press Enter on the preselected zone (or type `UTC`, Enter, if it renders as a filter).
  * Review table: `Username tester`, `Password *****`, `Full name Test Er`, `Email address t@example.org`, `Hostname omarchy`, `Timezone …`, `Keyboard us`.
  * Choose `No, change it` → back to the keyboard step; after Enter the form re-asks from `Username>` with empty fields. Then Ctrl+C at `Username>` → `Aborted installation` and a root prompt. End with `./client stop`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Type each rejected value quickly and screenshot on Enter — the notice lasts one second.
  * gum confirm: Left/Right or Tab moves between the two buttons; Enter picks the highlighted one.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of each notice (alphanumeric ×2, reserved ×2, hostname ×2), the review table with `Hostname omarchy`, and the empty re-ask after `No, change it`
  * If unsuccessful
  ** Screenshot of a rejected value being accepted, a notice with different wording, or the form skipping to the disk step
covers: install/provisioning/setup-form.sh (username/hostname/identity/timezone prompts, reserved list), configurator user_step review table, test/shell.d/setup-form-test.sh
merged-from: 42:install-rejects-bad-username-and-hostname

### iso-install-review-decline-and-escape-loop-to-keyboard   [VM-NO] [VM-OK-from-ISO]
description: Declining the review table must return to the very first screen and re-run the whole form, Escape on any field must do the same, and nothing may be written to disk until the disk confirm — proven from the ISO's second console while the wizard is still open. Not runnable on the resumed minted disk: needs an ISO ticket (`./client start` without `--resume`); no other harness change. No install is performed.
instruction: |
  <Instructions>
  From the desktop please do the following:
  (ISO ticket: `./client start` without `--resume`; "the desktop" is the ISO's tty1. Nothing is written to disk.)

  <ActionList>
  * Greeter → Enter. At `Select keyboard layout` press Down once (English (UK)), Enter.
  * Fill the form: `Username>` `loop`, `Password>` `prime`, `Confirm>` `prime`, Enter (name), Enter (email), `Hostname>` `loopbox`, Enter, `Timezone` Enter.
  * At `Does this look right?` press Right (or Tab) to `No, change it`, Enter → `Let's setup your machine...` with the layout picker again.
  * Press Enter (US this time), then at `Username>` press Escape → the keyboard step again.
  * Enter, then `Username>` `loop`, and at `Password>` press Escape → the keyboard step again.
  * Switch to tty2 with Ctrl+Alt+F2, log in as `root` (no password), run `lsblk -f /dev/vda; ls /root/*.json 2>&1` → the disk has no partitions or filesystems and no `user_*.json` exists yet. Ctrl+Alt+F1 back to the wizard.
  * Press Enter on the layout, then Ctrl+C at `Username>` → `Aborted installation` / `You can retry later by running: ./.automated_script.sh`. End with `./client stop`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * gum confirm: Left/Right or Tab moves between the two buttons; Enter picks the highlighted one.
  * Under English (UK) letters and digits are identical to US; only `@`/`"`/`#` move, so every value above types the same.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the keyboard step after `No, change it` and after each Escape, and of tty2 showing an untouched disk and no user files
  * If unsuccessful
  ** Screenshot of the form skipping to the disk step, or of files/partitions already present on tty2
covers: configurator user_step (No, change it → keyboard_form), setup-form OMARCHY_FORM_BACK handling, disk_form ordering (user before disk)
merged-from: 42:install-review-no-change-loops-to-keyboard

### iso-install-disk-picker-encryption-toggle-abort-and-retry   [VM-NO] [VM-OK-from-ISO]
description: The disk step must list only the target disk (never the install medium); the overwrite confirm must toggle between `Yes, install` (encrypted) and `Yes, install without encryption` on Ctrl+C and back; `No, change it` must return to the disk picker without touching the disk; Escape must abort cleanly; and the documented retry command must restart the wizard from the greeter. Not runnable on the resumed minted disk: needs an ISO ticket (`./client start` without `--resume`); no other harness change. No install is performed.
instruction: |
  <Instructions>
  From the desktop please do the following:
  (ISO ticket: `./client start` without `--resume`; "the desktop" is the ISO's tty1. Never press Enter on either affirmative button — that starts the install.)

  <ActionList>
  * Greeter → Enter; keyboard → Enter; form: `Username>` `disk`, `prime`/`prime`, Enter, Enter, Enter (hostname default), Enter (timezone); review → `Yes`.
  * `Let's select where to install Omarchy...` / `Select install disk` lists exactly one line `/dev/vda (40G) - …` and nothing for the cdrom (`/dev/sr0` or the ISO must not appear). Press Enter on `/dev/vda`.
  ** The blank 40G disk has no partition table, so the mode picker is skipped and the overwrite confirm comes next.
  * The confirm shows `Everything will be overwritten. There is no recovery possible.`, the grey hint `Press Ctrl+C for unencrypted install.`, buttons `Yes, install` / `No, change it` and the prompt `Confirm overwriting /dev/vda`.
  * Press Ctrl+C → the affirmative becomes `Yes, install without encryption` and the grey hint disappears. Press Ctrl+C again → back to `Yes, install` with the hint.
  * Move to `No, change it` (Right or Tab), Enter → back to `Select install disk`.
  * Press Escape → `Aborted installation` and `You can retry later by running: ./.automated_script.sh`, then a root prompt. Run `lsblk -f /dev/vda` → still empty.
  * Type `./.automated_script.sh`, Enter → the greeter appears again. Press Enter, then Ctrl+C at `Username>` and confirm the abort text once more. End with `./client stop`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * `Yes, install without encryption` is a highlighted button OCR may not read; trust the toggled label and the missing grey hint.
  * Ctrl+C toggles encryption only on this confirm; in the user step it aborts to a shell, on the keyboard screen it offers "prepare for another owner".
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the single-disk picker, the encrypted confirm, the unencrypted toggle and the toggle back, the return to the disk picker, the abort text with the empty `lsblk`, and the greeter after `./.automated_script.sh`
  * If unsuccessful
  ** Screenshot of `/dev/sr0` or the ISO listed, of Ctrl+C aborting the wizard instead of toggling, of the disk being partitioned, or of the retry command failing
covers: configurator disk_form/get_root_disk/get_disk_info/abort, configurator confirm_disk_overwrite/select_installation/requires_full_disk_install, .automated_script.sh (retry entry point), manual/02 (No-encryption installations)
merged-from: 42:install-disk-picker-and-esc-abort-retry; 42:install-encryption-toggle-and-back

### iso-install-unencrypted-boots-to-sddm-greeter   [VM-NO] [VM-OK-from-ISO] [SLOW]
description: Login follows encryption: an unencrypted full-disk install must boot with no LUKS prompt to the SDDM greeter (no autologin), reject a wrong password, log the user in and leave no encryption artefacts, while an encrypted install stops at the passphrase prompt and then autologs in — the rule the manual states for interactive (manual/02) and unattended (manual/51) installs alike. Not runnable on the resumed minted disk: needs an ISO ticket (`./client start` without `--resume`); budget ~15 minutes; no other harness change. The disk is altered: `stop` is required.
instruction: |
  <Instructions>
  From the desktop please do the following:
  (ISO ticket: `./client start` without `--resume`; "the desktop" is the ISO's tty1 until the install finishes. Budget ~15 minutes.)

  <ActionList>
  * Greeter → Enter; keyboard → Enter; form: `Username>` `plain`, `prime`/`prime`, `Full name>` `Plain User`, `Email address>` `plain@example.org`, `Hostname>` `plainbox`, `Timezone` Enter; review `Yes`; disk `/dev/vda` Enter.
  * At the confirm press Ctrl+C (the button becomes `Yes, install without encryption` and the grey hint disappears), then Enter.
  * The dashboard shows `Installing Omarchy`, the bar and rotating tips. Screenshot every 5 s (the install takes 5–10 minutes). Finish screen: `Installed Omarchy in Xm Ys` and a `Reboot Now` button — press Enter.
  * Boot: Plymouth splash, **no passphrase prompt**, then the SDDM greeter (Omarchy theme, user `plain` selected, a password field).
  ** Encrypted counterpart of the same rule: an encrypted install (the minted disk on every `--resume`, or `iso-install-custom-keyboard-hostname-timezone-identity`) stops at the Plymouth passphrase prompt and then lands on the desktop with no SDDM step.
  * Unhappy path: type `wrong`, Enter → stays on the greeter (red lock/entry, cleared by the next keystroke). Type `prime`, Enter → the desktop; the first-run toasts **Learn Keybindings** and **Update System** appear.
  ** Stay well under five wrong tries: faillock `deny=10` is shared with the lock screen and sudo.
  * Open a terminal with Super+Enter and type `ls /etc/sddm.conf.d/; lsblk -f /dev/vda; grep -c cryptdevice /proc/cmdline; hostname; git config --global user.name` → only `99-omarchy-login.conf` (no `autologin.conf`), `vda1 vfat` + `vda2 btrfs` with no `crypto_LUKS`, `0`, `plainbox`, `Plain User`.
  * End with `./client stop` (do not save).
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * `Yes, install without encryption` is a highlighted button OCR may not read; trust the Ctrl+C toggle and the missing grey hint.
  * The SDDM theme has no username field, session chooser or power buttons — logo, lock glyph and a dotted entry. If the greeter does not appear within 3 minutes of the reboot, switch to Ctrl+Alt+F3, log in on the console and inspect `journalctl -b -u sddm`.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the unencrypted confirm, the dashboard, the finish screen, the SDDM greeter after boot with no passphrase prompt, the rejected password, the desktop with first-run toasts, and the terminal checks (no `autologin.conf`, no LUKS, hostname, git name)
  * If unsuccessful
  ** Screenshot of a LUKS prompt (toggle failed), an autologin straight to the desktop (login config wrong), or the failure screen with `failed phase:`; `./client get-serial`
covers: configurator confirm_disk_overwrite (Ctrl+C), omarchy-iso configure_login (no autologin when unencrypted; autologin when encrypted), install-dashboard finish/reboot prompt, install/user/{git,first-run}.sh, manual/02 (No-encryption installations), manual/02:31-35, manual/51:59-61
merged-from: 42:install-declines-encryption-sddm-login; 13:unattended-install-encrypted-needs-passphrase-at-first-boot

### iso-install-custom-keyboard-hostname-timezone-identity   [VM-NO] [VM-OK-from-ISO] [SLOW]
description: Non-default answers (German keyboard, custom hostname, a chosen timezone, full name and email) must all land on the installed system — console keymap and XKB layout, hostname, timezone, git identity and XCompose bindings — and the encrypted install must boot through the LUKS prompt to an autologged-in desktop. Not runnable on the resumed minted disk: needs an ISO ticket (`./client start` without `--resume`); budget ~15 minutes; no other harness change. The disk is altered: `stop` is required.
instruction: |
  <Instructions>
  From the desktop please do the following:
  (ISO ticket: `./client start` without `--resume`; "the desktop" is the ISO's tty1 until the install finishes. Budget ~15 minutes.)

  <ActionList>
  * Greeter → Enter. At `Select keyboard layout` press Down repeatedly until `German` is highlighted (the list is paginated: English (US), English (UK), Dvorak, Colemak, then alphabetical — German is about 22 rows down), Enter.
  ** The console now uses the German layout: from here type only letters and digits without `y`/`z`.
  * `Username>` `dieter`, Enter; `Password>` `prime`, `Confirm>` `prime`; `Full name>` `Dieter Test`, Enter; `Email address>` `dieter@example.org`, Enter; `Hostname>` `de-box-01`, Enter.
  ** The `@` is AltGr+Q on German — if it does not type, press Enter to skip the email and note it. `-` is on the key right of `.`; if `de-box-01` will not type, use `debox01`.
  * `Timezone`: if a list is preselected, type nothing and press Down/Up to `Europe/Berlin` (or, if it is a filter, type `Berlin`), Enter.
  * Review table: `Keyboard de`, `Hostname de-box-01`, `Timezone Europe/Berlin`. Choose `Yes`. Disk `/dev/vda` Enter; confirm `Yes, install` (encrypted) Enter. Wait for `Reboot Now` (screenshot every 5 s), Enter.
  * At the LUKS prompt type `prime`, Enter (letters are identical on de; type blind — the prompt is not reliably OCR-able) → autologin desktop with no SDDM step.
  * Open a terminal with Super+Enter and type `localectl status; hostnamectl hostname; timedatectl show -p Timezone --value; git config --global user.name; git config --global user.email; grep -E '<n>|<e>' ~/.XCompose; cat /etc/vconsole.conf` → `VC Keymap: de`, `X11 Layout: de`, `de-box-01`, `Europe/Berlin`, `Dieter Test`, the email, both XCompose bindings filled, `KEYMAP=de` + `XKBLAYOUT=de`.
  * Unhappy-path check: `sudo grep -c 'keymap .* unknown' /var/log/omarchy-install.log` → `0` (the layout was known to localectl). End with `./client stop`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * gum choose does not filter on typing; use the arrow keys and screenshot to confirm the highlight before Enter.
  * `<` and `>` in the grep are sent as `<LT>` and `<GT>`.
  * Never give three wrong LUKS passphrases — the prompt drops to an emergency shell after the third.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the review table with `de`/`de-box-01`/`Europe/Berlin`, the LUKS prompt then the autologged-in desktop, and the terminal output showing keymap, hostname, timezone, git identity and XCompose lines
  * If unsuccessful
  ** The terminal output with the value that did not land, and `/var/log/omarchy-install.log` lines mentioning keyboard/timezone (`sudo grep -iE 'keymap|timezone' /var/log/omarchy-install.log | sudo tee /dev/ttyS0`, then `./client get-serial`)
covers: configurator keyboard_form (loadkeys), omarchy-iso keyboard.py configure_keyboard, arch_install_system (hostname/timezone), install/user/{git,xcompose}.sh, install/hardware/set-wireless-regdom.sh (DE), setup-form OMARCHY_KEYBOARD_LAYOUTS, test_keyboard.py
merged-from: 42:install-custom-keyboard-hostname-timezone-identity

### iso-install-prepare-for-another-owner-first-boot   [VM-NO] [VM-OK-from-ISO] [SLOW]
description: "Prepare this machine for another owner" (Ctrl+C on the installer's keyboard screen, with `No, keep setting up` returning to the picker) must install with no user, reboot on its own without a LUKS prompt, and on first boot walk the owner through keyboard, account, hostname and timezone, then re-key the disk to the owner's password and autologin — the OEM/hand-over flow end to end. Not runnable on the resumed minted disk: needs an ISO ticket (`./client start` without `--resume`); budget ~20 minutes; no other harness change. The disk is altered: `stop` is required.
instruction: |
  <Instructions>
  From the desktop please do the following:
  (ISO ticket: `./client start` without `--resume`; "the desktop" is the ISO's tty1 until first boot completes. Budget ~20 minutes.)

  <ActionList>
  * Greeter → Enter. At `Select keyboard layout` (the dimmed line `Press Ctrl+C to prepare this machine for another owner.` sits under the picker) press Ctrl+C → `Prepare this machine for another owner?` with `Yes, prepare for another owner` / `No, keep setting up`.
  ** Unhappy path: choose `No, keep setting up` → the layout picker returns. Press Ctrl+C again and choose `Yes, prepare for another owner`.
  * The wizard skips the user form and jumps straight to `Select install disk`. Enter on `/dev/vda`; confirm `Everything will be overwritten…` with `Yes, install` (encrypted).
  * The dashboard runs (screenshot every 5 s); at the end there is **no** `Installed Omarchy in …`/`Reboot Now` screen — the machine reboots by itself.
  * First boot: **no LUKS passphrase prompt**; the console greeter `Beautiful, Fun & Agentic Linux by DHH` / `Press Return to Start Setup` appears. Enter. `Let's setup your keyboard...` → press Down once (English (UK)), Enter.
  * `Let's setup your user account...`: `Username>` `owner`, `Password>` `prime`, `Confirm>` `prime`, `Full name>` `New Owner`, `Email address>` type `owner`, then Shift+' (the `@` on UK), then `example.org`, Enter; `Hostname>` `handed-over`, Enter. `Let's set your timezone...` → Enter on the guess (or type `UTC`, Enter). Review table (Keyboard `English (UK)`, Username, Password, Full name, Email, Hostname `handed-over`, Timezone) → `Yes`.
  * `Setting up your machine` with the bar and tips runs 2–5 minutes; then the desktop appears with no login prompt.
  * Open a terminal with Super+Enter and type `hostname; localectl status | head -3; ls /var/lib/omarchy/provisioning/; grep -c cryptkey /proc/cmdline; sudo cryptsetup luksDump /dev/vda2 | grep -cE '^\s+[0-9]+: luks2'; cat /etc/sddm.conf.d/autologin.conf; ls /etc/sudoers.d/00-omarchy-wheel /etc/omarchy/provisioning.key 2>&1; systemctl is-enabled omarchy-provision-owner 2>&1` (sudo password `prime`) → `handed-over`, keymap `uk`, only `packages` (and `groups`) with no `pending`, `0`, `1` keyslot, autologin for `owner`, the wheel drop-in present and `provisioning.key` absent, the unit disabled/not-found.
  * Reboot once more (`systemctl reboot`): now the LUKS prompt **does** appear and `prime` unlocks it → autologin desktop. End with `./client stop`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Under English (UK) letters and digits are identical to US; only `@`/`"`/`#` move.
  * The first-boot form waits for the virtio-gpu console resize before drawing; give it a few seconds. If `Setup hit an error` appears, choose `Drop to console`, read `/var/log/omarchy-provision-owner.log`, screenshot it, then run `omarchy-provision-owner` to retry.
  * The same `omarchy-provision-owner` form is exercised by the factory-reset tests, which are runnable on the minted disk.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the prepare-for-another-owner confirm (both answers), the disk-first flow with the user step skipped, the silent auto-reboot, the first-boot greeter with no LUKS prompt, each form step, the progress bar, and the desktop
  ** Screenshot of the terminal checks: hostname, keymap uk, one keyslot, no cryptkey, autologin, wheel drop-in, no provisioning.key
  ** Screenshot of the LUKS prompt on the second reboot and the desktop after `prime`
  * If unsuccessful
  ** Screenshot of Ctrl+C aborting the installer, the user step still asked, a `Reboot Now` prompt (deferral not armed), a LUKS prompt on the first boot (auto-unlock missing), `Setup hit an error`, or a user-less SDDM greeter; `./client get-serial`
covers: configurator keyboard_form Ctrl+C/confirm_prepare_for_another_owner/deferred path, configurator:207-252, omarchy-iso context.py deferred handling, stage_provisioning_state/_stage_provisioning_luks_unlock, _validate_provisioning_state, configure_login (deferred), install-dashboard OMARCHY_UI_DEFER_PROVISIONING, bin/omarchy-provision-owner (all of it), install/provisioning/*, manual/02 (Installing for another owner), manual/02:25, omarchy-iso-test --provision, test_provisioning_state.py
merged-from: 42:install-deferred-provisioning-firstboot; 13:install-prepare-for-another-owner-ctrl-c

### iso-first-boot-owner-form-errors-and-reboot   [VM-NO] [VM-OK-from-ISO] [SLOW]
description: The first-boot owner form must handle every escape hatch: Ctrl+C offers a confirmed reboot (declining continues), invalid usernames, passwords and hostnames are refused with the documented notices, Escape unwinds to the keyboard step, `No, change it` re-runs the form, and a reboot mid-setup simply restarts setup with the disk still auto-unlocking. Not runnable on the resumed minted disk: needs an ISO ticket (`./client start` without `--resume`) and a deferred install first; budget ~20 minutes; no other harness change. The disk is altered: `stop` is required.
instruction: |
  <Instructions>
  From the desktop please do the following:
  (ISO ticket: `./client start` without `--resume`; budget ~20 minutes. First do the deferred install exactly as in `iso-install-prepare-for-another-owner-first-boot` — Ctrl+C on the layout picker, `Yes, prepare for another owner`, `/dev/vda`, `Yes, install` — up to the first-boot greeter `Press Return to Start Setup`.)

  <ActionList>
  * Greeter → Enter. At `Let's setup your keyboard...` press Ctrl+C → `Setup starts again after the reboot.` / `Reboot this machine?` with `Yes, reboot` / `No, keep setting up`. Choose `No, keep setting up` → the layout picker returns.
  * Enter (US). `Username>` type `root`, Enter → `Username is reserved for system`; type `Bad Name`, Enter → `Username must be alphanumeric with no spaces`; type `owner`, Enter.
  * `Password>` `prime`, `Confirm>` `wrong` → `Passwords didn't match!`; `Password>` Enter, `Confirm>` Enter → `Your password can't be blank!`; then `prime`/`prime`.
  * At `Full name>` press Escape → back to `Let's setup your keyboard...`. Enter, then re-enter `owner`, `prime`/`prime`, Enter, Enter.
  * `Hostname>` type `bad host`, Enter → `Hostname must be 1-63 letters, digits, or dashes, and cannot start or end with a dash`; type `owner-box`, Enter. `Timezone` Enter. At the review choose `No, change it` → back to the keyboard step.
  * At this fresh keyboard step press Ctrl+C → `Yes, reboot` → the machine reboots with no LUKS prompt and the greeter `Press Return to Start Setup` returns (setup is neither lost nor bypassed).
  ** A reboot before the review is safe by design: the service re-arms until `pending` is cleared. If time runs short this step may be skipped — say so in the result.
  * Redo the form (`owner`, `prime`/`prime`, Enter, Enter, `owner-box`, Enter, Enter) and choose `Yes`; let `Setting up your machine` complete → desktop. Open a terminal with Super+Enter and type `hostname; ls /var/lib/omarchy/provisioning/` → `owner-box` and no `pending`. End with `./client stop`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The notices last one second; screenshot right after Enter.
  * The first-boot form waits for the virtio-gpu console resize before drawing; give it a few seconds.
  * gum confirm: Left/Right or Tab moves between the two buttons; Enter picks the highlighted one.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the reboot confirm and its decline, the username/password/hostname notices, the Escape unwind, the `No, change it` loop, the mid-setup reboot returning to the greeter with no LUKS prompt, and the finished desktop with `owner-box` and no `pending`
  * If unsuccessful
  ** Screenshot of Ctrl+C dropping to a shell, SDDM appearing without a user, or a notice with different wording; `cat /var/log/omarchy-provision-owner.log | sudo tee /dev/ttyS0` then `./client get-serial`
covers: bin/omarchy-provision-owner (keyboard_form/confirm_reboot/user_form/run_setup), install/provisioning/setup-form.sh (all prompts, OMARCHY_FORM_BACK/SIGNAL), install/provisioning/omarchy-provision-owner.service (re-arms while pending), test/shell.d/setup-form-test.sh
merged-from: 42:install-deferred-provisioning-form-errors

### iso-install-failure-screen-and-retry   [VM-NO] [VM-OK-from-ISO]
description: When an install phase fails, the dashboard must show the failure screen with the failed phase and error, offer `Upload log for support` / `View full log` / `Drop to shell` / `Reboot` / `Power off`, and let the operator repair and rerun the installer from the shell — tested by injecting a fast, deterministic failure on the live ISO before any disk write. Not runnable on the resumed minted disk: needs an ISO ticket (`./client start` without `--resume`); ~5 minutes; no other harness change. No install completes.
instruction: |
  <Instructions>
  From the desktop please do the following:
  (ISO ticket: `./client start` without `--resume`; "the desktop" is the ISO's tty1. No install completes; ~5 minutes.)

  <ActionList>
  * At the greeter press Ctrl+Alt+F2, log in as `root` (no password), run `mv /usr/local/bin/omarchy-iso-cleanup-disk /root/` (the live root is a writable overlay), then Ctrl+Alt+F1.
  * Enter; keyboard Enter; form `Username>` `fail`, `prime`/`prime`, defaults; review `Yes`; disk Enter; confirm `Yes, install` Enter.
  * Within about 30 s the failure screen appears: `Omarchy installation stopped`, `Installer exited with status 1`, `last installer phase: Preparing live environment`, `failed phase: Preparing live environment: [Errno 2] No such file or directory: 'omarchy-iso-cleanup-disk'`, `Last log lines:` tail, `Get help at https://omarchy.org/discord`, and the menu `What would you like to do?` (`Upload log for support`, `View full log`, `Drop to shell`, `Reboot`, `Power off`).
  ** The failure text is centred and truncated to the logo width; the `failed phase:` line may be cut with `…`.
  * Choose `View full log` → `less` on `/var/log/omarchy-install.log` showing `Phase 'Preparing live environment' failed`; press `q` → the failure screen is redrawn.
  * Choose `Drop to shell` → root prompt. Run `mv /root/omarchy-iso-cleanup-disk /usr/local/bin/ && lsblk -f /dev/vda` → the disk is still blank (the failure happened before any write).
  * Run `./.automated_script.sh` → the greeter returns; walk the wizard again to the confirm and this time watch the dashboard get past `Preparing live environment` (bar advancing, tips rotating) for 60 s. Then `./client stop` (the install has begun writing the disk; do not save).
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Do not choose `Upload log for support` (it posts the log to a public paste service) or `Reboot`/`Power off` (they end the session).
  * `omarchy-install-diagnose-media` offers no diagnosis for this non-media failure; the screen shows the raw phase error.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the failure screen with the phase name and the five-item menu, of `less` with the phase error, of the redraw after `q`, of the untouched disk, and of the second run's dashboard advancing past the phase
  * If unsuccessful
  ** Screenshot of the dashboard hanging on the bar or exiting without the failure screen; from the root shell `tail -30 /var/log/omarchy-install.log` (screenshot, or `tail -30 /var/log/omarchy-install.log > /dev/ttyS0` then `./client get-serial`)
covers: omarchy-install-dashboard (render_failure, failure_menu, view_failure_log), orchestrator phases.py (PhaseError, state.json failed phase), prepare_live, .automated_script.sh retry, omarchy-install-diagnose-media (no diagnosis for a non-media failure)
merged-from: 42:install-failure-screen-and-retry

### iso-install-offline-timezone-fallback   [VM-NO] [VM-OK-from-ISO]
description: With no network the installer must still work fully offline: the timezone step must fall back to a type-to-filter list instead of a geo-guess, an empty choice must default to `UTC`, and the offline mirror means no download is ever attempted — the link is taken down from inside the guest on the ISO's second console. Not runnable on the resumed minted disk: needs an ISO ticket (`./client start` without `--resume`); ~5 minutes; no other harness change. No install is performed.
instruction: |
  <Instructions>
  From the desktop please do the following:
  (ISO ticket: `./client start` without `--resume`; "the desktop" is the ISO's tty1. ~5 minutes, no install completes.)

  <ActionList>
  * At the greeter press Ctrl+Alt+F2, log in as `root` (no password), run `ip -br link` to find the NIC (e.g. `enp0s3`/`ens3`), then `ip link set <nic> down; ip -br addr` → no IPv4 address. Ctrl+Alt+F1.
  * Enter; keyboard Enter; form `Username>` `offl`, `prime`/`prime`, Enter, Enter, Enter (hostname default).
  * `Timezone` now renders as a **filter** (a text field with `>` above the list) rather than a preselected list. Type `Copenh` → the list narrows to `Europe/Copenhagen`; press Enter.
  * The review shows `Timezone Europe/Copenhagen`. Choose `No, change it`, redo the form and at `Timezone` press Enter on the empty filter → the review shows `Timezone UTC`.
  * Choose `No, change it` again and Ctrl+C at `Username>` to abort. On tty2 (Ctrl+Alt+F2) run `ip link set <nic> up` (restores the guest network), then `./client stop`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * `tzupdate` fails fast without a route; if the picker still appears preselected, the NIC was not down — check `ip -br addr` on tty2.
  * Type the interface name you read from `ip -br link` in place of `<nic>` (no angle brackets).
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of tty2 with no IPv4 address, the filter-style timezone picker, the narrowed `Europe/Copenhagen`, and the review table with `UTC` after an empty selection
  * If unsuccessful
  ** Screenshot of the wizard hanging at the timezone step or crashing, or of a preselected (online-style) picker; the tty2 `ip -br addr` output
covers: install/provisioning/setup-form.sh (omarchy_prompt_timezone guess/filter/UTC), configurator (offline install, mirror), test/shell.d/setup-form-test.sh (timezone cases)
merged-from: 42:install-offline-timezone-fallback

### iso-unattended-cidata-install-with-ssh-key   [VM-NO]
description: With a second drive labelled `CIDATA` carrying the configurator's files the ISO must install with nobody at the keyboard, reboot on its own, and come up as the configured user with hostname and timezone applied, sshd enabled, the supplied key authorized (mode 600, user-owned) and port 22 opened with a plain `ufw allow` and password authentication still on — CODE-INTENDED (03-INTENDED-BEHAVIOUR #3): the unattended chapter (manual/51:27) documents exactly that ("opens the firewall … only adds your keys — it doesn't loosen any of the SSH daemon's other authentication settings"); the rate-limited `limit` in manual/48 describes the `Setup → Security → SSHD` path, so the two paths differ by design (maintainer note: a cidata install is weaker than the menu path); without the drive (or with an incomplete one) the normal wizard appears. Needs harness support: an extra `cidata` drive attached at `./client start` (`-drive file=cidata.img,format=raw` or `-device usb-storage`, made with `mkfs.vfat -n CIDATA`); the driver cannot add it today, so this stays `VM-NO` even from an ISO ticket. The disk is altered: `stop` is required.
instruction: |
  <Instructions>
  From the desktop please do the following:
  (ISO ticket plus a `CIDATA` drive holding `user_configuration.json` (full-disk `/dev/vda` layout, `defer_provisioning: false`, hostname `auto-box`, timezone `UTC`, keyboard `us`), `user_credentials.json` (user `auto`, `openssl passwd -6 prime` hash, `sudo: true`), `user_full_name.txt`, `user_email_address.txt`, `user_encrypt_installation.txt` = `false`, and `authorized_keys` with one ed25519 key. The reference for the exact JSON is `test/integration.d/base-test.sh build_cidata`.)

  <ActionList>
  * Boot; after Plymouth, tty1 prints `Autoinstall configuration found on cidata drive; skipping the configurator.` and goes straight to the `Installing Omarchy` dashboard — no greeter, no keyboard picker, no questions.
  * When the bar completes the machine reboots without a `Reboot Now` prompt. Screenshot every 5 s.
  * The SDDM greeter appears (unencrypted → no autologin) for user `auto`. Type `prime`, Enter → the desktop.
  ** With `user_encrypt_installation.txt` = `true` and a `disk_encryption` password the first boot instead stops at the Plymouth passphrase prompt and then autologs in (see `iso-install-unencrypted-boots-to-sddm-greeter`).
  * Open a terminal with Super+Enter and type `whoami; hostname; timedatectl | grep 'Time zone'; git config --global user.name` → `auto`, `auto-box`, `UTC`, the full name.
  * Type `systemctl is-enabled sshd; sudo ufw status | grep 22; sudo sshd -T | grep -i passwordauthentication` → `enabled`, `22/tcp ALLOW IN Anywhere` (note `ALLOW`, not the `LIMIT` the interactive `omarchy-setup-security-sshd` writes — intended, per manual/51:27), and `passwordauthentication yes` (the unattended path does not disable password logins — also intended). Record both facts; a `LIMIT` rule or `passwordauthentication no` here would mean the behaviour changed.
  * Type `cat ~/.ssh/authorized_keys | wc -l; ls -ld ~/.ssh ~/.ssh/authorized_keys` → `1`, `drwx------` and `-rw-------` owned by `auto`. If the matching private key was included on the drive: `ssh -o StrictHostKeyChecking=no auto@localhost true; echo "exit=$?"` → `exit=0`.
  * Unhappy variants (separate ISO tickets): no drive, or a drive with `user_configuration.json` alone → the `Select keyboard layout` wizard appears normally; a drive with an empty `authorized_keys` → the failure screen with `failed phase: Configuring SSH access: /root/authorized_keys contains no SSH keys` and the process exits to the shell (non-interactive: no menu).
  * End with `./client stop`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * `./client get-serial` on the ISO boot shows whether `omarchy-cidata-load` found the drive; if the greeter appears despite the drive, check the volume label (`CIDATA`).
  * On a stock (non-cidata) install sshd is `disabled` and there is no port-22 rule; that half belongs to the firewall-defaults test on the minted disk.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the skip message, the dashboard with no wizard, the automatic reboot into SDDM, and the terminal checks (user, hostname, timezone, git name; sshd `enabled`; the `22/tcp ALLOW IN` rule; `passwordauthentication yes`; one key with 700/600 permissions owned by the user)
  ** The wizard when the drive is absent or incomplete; the SSH-access failure text for an empty `authorized_keys`
  * If unsuccessful
  ** Screenshot of the greeter appearing despite a valid drive (files not found: check the label), dashboard errors or the failure screen text, wrong user/hostname/timezone, sshd disabled, port closed, or keys missing/root-owned; `cat /var/log/omarchy-install.log | sudo tee /dev/ttyS0` and `./client get-serial`
covers: omarchy-cidata-load, .automated_script.sh (OMARCHY_UI_INTERACTIVE=no), omarchy-install-dashboard (interactive()), orchestrator configure_ssh_access, orchestrator phases, omarchy-iso configure_ssh_access, bin/omarchy-provision-owner install_authorized_keys, manual/51:3-21, manual/51:27, manual/51:33-56, manual/02:29, README Autoinstall, test/unit/cidata-load-test.sh, test_configure_ssh_access.py, 13-manual-rest Observations #19b
merged-from: 42:install-unattended-cidata; 13:unattended-install-cidata-full; 13:unattended-install-authorized-keys-enables-sshd

### iso-unattended-cidata-defer-marker-first-boot   [VM-NO]
description: A `CIDATA` drive with an empty `defer-provisioning` file in place of credentials must produce a user-less install that reboots straight into first-boot setup (no LUKS prompt — a throwaway key auto-unlocks), with staged SSH keys installed for whoever creates the account, and after the form the disk is re-keyed to the owner's password; a `user_credentials.json` beside the marker must still create no user, and a drive with `user_configuration.json` alone falls back to the wizard. Needs harness support: an extra `cidata` drive attached at `./client start`; the driver cannot add it today, so this stays `VM-NO` even from an ISO ticket. The disk is altered: `stop` is required.
instruction: |
  <Instructions>
  From the desktop please do the following:
  (ISO ticket plus a `CIDATA` drive holding `user_configuration.json` (encrypted full-disk layout with a `disk_encryption` block **without** `encryption_password`), an empty `defer-provisioning`, `user_encrypt_installation.txt` = `true`, and `authorized_keys`.)

  <ActionList>
  * Boot → tty1 prints `Autoinstall configuration found on cidata drive` → the `Installing Omarchy` dashboard with no wizard → silent reboot (no finish screen, no `Reboot Now`).
  * First boot: **no LUKS passphrase prompt** (the throwaway key auto-unlocks); the console greeter `Press Return to Start Setup` appears. Enter.
  * Complete the first-boot form: keyboard picker (Enter), `Username>` `owner`, `Password>` `prime`, `Confirm>` `prime`, name and email (Enter, Enter), `Hostname>` Enter, `Timezone` Enter, review `Yes`; the progress screen runs, then the desktop appears as `owner` with no login prompt.
  ** The form is the same `omarchy-provision-owner` exercised by `iso-first-boot-owner-form-errors-and-reboot` and by the factory-reset tests on the minted disk.
  * Open a terminal with Super+Enter and type `cat ~/.ssh/authorized_keys | wc -l; ls -ld ~/.ssh; systemctl is-enabled sshd; sudo ufw status | grep 22; sudo cryptsetup luksDump /dev/vda2 | grep -cE '^\s+[0-9]+: luks2'; grep -c cryptkey /proc/cmdline` (sudo password `prime`) → `1`, `drwx------ owner`, `enabled`, a `22/tcp ALLOW IN` rule, `1` keyslot, `0`.
  * Reboot (`systemctl reboot`): the passphrase prompt now appears and takes the password chosen in the form (`prime`) → autologin desktop.
  * Unhappy variants (separate ISO tickets): the same drive **with** a `user_credentials.json` carrying `users` → the install must still create no user (the context strips account fields) and the first boot asks for the owner; a drive with `user_configuration.json` alone (no marker, no credentials) → the normal `Select keyboard layout` wizard during install.
  * End with `./client stop`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The marker replaces credentials for cidata-load's required pair; a `user_credentials.json` beside it is only read for `encryption_password`.
  * `./client get-serial` on the ISO boot shows whether `omarchy-cidata-load` found the drive.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the skip line, the wizard-less dashboard, the first-boot greeter with no LUKS prompt, the form and the desktop, the terminal checks (staged key installed and user-owned, sshd enabled, the ufw rule, one keyslot, no cryptkey), and the passphrase prompt accepting the new password after the reboot
  * If unsuccessful
  ** Screenshot of a wizard during install, SDDM asking for a user that does not exist, no first-boot form, the install passphrase still unlocking, or the failure screen; `cat /var/log/omarchy-provision-owner.log | sudo tee /dev/ttyS0` then `./client get-serial`
covers: omarchy-cidata-load (defer-provisioning marker), context.py (_strip_account_fields, _inject_provisioning_encryption_password), configure_ssh_access (deferred staging), bin/omarchy-apply-system --defer-provisioning, bin/omarchy-provision-owner (install_authorized_keys), manual/51:23, manual/02:25, test_provisioning_state.py
merged-from: 42:install-unattended-defer-marker; 13:unattended-install-defer-provisioning-marker

### iso-unattended-cidata-tailscale-authkey-joins   [VM-NO] [NET]
description: With a `tailscale_authkey` file on the `CIDATA` drive the installed machine joins the tailnet on first boot, retrying every 15 s until it has network, opens the firewall on `tailscale0`, and deletes the key file afterwards; an invalid key keeps retrying and leaves the key in place. Needs harness support: an extra `cidata` drive attached at `./client start` plus a real reusable pre-authorized Tailscale auth key (a secret the ticket must carry); the driver cannot add either today, so this stays `VM-NO` even from an ISO ticket. The disk is altered: `stop` is required.
instruction: |
  <Instructions>
  From the desktop please do the following:
  (ISO ticket plus a `CIDATA` drive holding the unattended `user_configuration.json` + `user_credentials.json` pair and a reusable pre-authorized key in `tailscale_authkey`. Outbound network is needed for the join.)

  <ActionList>
  * Boot through the unattended install and the first boot (as in `iso-unattended-cidata-install-with-ssh-key`) to the desktop.
  * Open a terminal with Super+Enter and type `systemctl status omarchy-tailscale-join.service | head -5; tailscale status` → the join unit succeeded and this machine is listed.
  ** The unit retries until the network is up; if `tailscale status` does not list the machine yet, re-run it after a few seconds rather than sleeping long.
  * Type `sudo ufw status | grep tailscale0; ls /etc/tailscale/authkey 2>&1` → `Anywhere on tailscale0 ALLOW IN` and `No such file` (the key was deleted after the join).
  * Unhappy variant (separate ISO ticket with an invalid key): `journalctl -u omarchy-tailscale-join.service | tail | sudo tee /dev/ttyS0`, then `./client get-serial` → repeated retries every 15 s; `ls /etc/tailscale/authkey` → the key file still present.
  * End with `./client stop`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The interactive `Install → Service → Tailscale` blocks at `sudo tailscale up` waiting for a browser login and is separately not runnable here.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the join unit status, `tailscale status` listing the machine, the `tailscale0` ufw rule, and the missing key file
  * If unsuccessful
  ** The join never succeeding with a valid key, the key left behind, or the ufw rule missing; the `journalctl` tail via `./client get-serial`
covers: manual/51:29; omarchy-iso configure_tailscale; bin/omarchy-install-service-tailscale (interactive counterpart)
merged-from: 13:unattended-install-tailscale-authkey-joins

### iso-install-free-space-alongside-existing-os   [VM-NO]
description: On a disk that already holds another OS (a Windows-style ESP and data partition with free space) the installer must offer `Free space install (alongside existing data)` next to `Full disk install`, leave the existing partitions and their EFI entry untouched, create its own dedicated EFI partition in free space, keep encryption by default (Ctrl+C toggles it off), and boot; afterwards `limine-scan` adds the other loader. Too little free space (< 32 GiB) must stop with the exact size (`Not enough free space on /dev/vda` / `… has 20.0GB of usable free space; Omarchy needs at least 32GB.`), offer `Back` or the partition tool (cfdisk) and return to the mode picker without touching the disk; a BitLocker-protected partition aborts (`BitLocker signature detected on /dev/vdaN.` / `Aborted: BitLocker is enabled on this disk.`, `Suspending BitLocker is not enough — the drive stays encrypted.`). Needs harness support: a pre-partitioned fixture disk passed at `./client start` (e.g. `--disk` with the 96 GiB `omarchy-iso-test-windows-disk` image, plus the < 32 GiB-free, BitLocker and `--gap` variants); the driver cannot attach one today, so this stays `VM-NO` even from an ISO ticket. The disk is altered: `stop` is required.
instruction: |
  <Instructions>
  From the desktop please do the following:
  (ISO ticket with `--disk <fixture>`: the 96 GiB synthetic disk with `WINDOWS_ESP` (512 MiB, contains `EFI/Microsoft`), `WINDOWS_DATA` (ext4 holding `OMARCHY-MUST-NOT-TOUCH.txt`) and ≥ 64 GiB free.)

  <ActionList>
  * Greeter → keyboard → form (`Username>` `dual`, `prime`/`prime`, defaults) → review `Yes` → the disk picker shows `/dev/vda (96G) … [vfat, ext4]`; Enter.
  * `Select installation mode on /dev/vda` lists `Full disk install`, `Free space install (alongside existing data)`, `Choose a different disk`.
  ** Unhappy path: choose `Choose a different disk` → the disk picker again; pick the disk once more and choose `Free space install`.
  * Screens: `Checking for BitLocker on /dev/vda`, `Checking existing EFI partitions on /dev/vda` → `Found a Windows ESP at /dev/vda1 — leaving it untouched.` / `Omarchy will create its own dedicated EFI partition in free space.`, `Analyzing free space on /dev/vda`, then `Install Omarchy in the ~75.0GB of free space.` with `Press Ctrl+C for unencrypted install.`.
  ** Press Ctrl+C once to see the affirmative become `Yes, install without encryption`, Ctrl+C again to return to `Yes, install` (encrypted), then Enter on `Yes, install`.
  * `Creating partitions on /dev/vda`, `Setting up LUKS2 on /dev/vda4`, `Creating Btrfs filesystem and subvolumes`, then the dashboard (screenshot every 5 s). Wait for `Reboot Now`, Enter.
  * LUKS prompt `prime` (typed blind) → autologin desktop. Open a terminal with Super+Enter and type `lsblk -f /dev/vda; sudo mount -o ro /dev/vda2 /mnt && ls /mnt && sudo umount /mnt; sudo grep -E '^/' /boot/limine.conf; findmnt /boot` → vda1 vfat `WINDOWS_ESP`, vda2 ext4 `WINDOWS_DATA`, vda3 vfat `OMARCHY_EFI`, vda4 crypto_LUKS; `OMARCHY-MUST-NOT-TOUCH.txt` still present; limine entries include `/Omarchy` (a Windows entry only if a real `bootmgfw.efi` existed); `/boot` on `/dev/vda3`.
  * Type `cat /etc/crypttab.initramfs; grep -o 'cryptdevice=UUID=[^ ]*' /proc/cmdline` → `omarchy_root UUID=…` and a matching `cryptdevice=UUID` (protected-mode cmdline). Then `sudo limine-scan`, follow its prompts to add the other loader, reboot (`systemctl reboot`) and see both entries at boot.
  * Unhappy variant — too little free space (separate fixture ticket: a GPT whose partitions leave e.g. 20 GiB free): wizard to the mode picker, choose `Free space install (alongside existing data)`; after the BitLocker/ESP/analysis screens → `Not enough free space on /dev/vda` / `/dev/vda has 20.0GB of usable free space; Omarchy needs at least 32GB.` / `Open the partition tool to free at least 32GB on /dev/vda, then try again.` with buttons `Back` / `Open partition tool`. Choose `Open partition tool` → `Partition tool for /dev/vda` with two grey hints and `Open cfdisk` / `Back`; choose `Open cfdisk` → cfdisk opens on `/dev/vda`; press `q` to quit without writing → the mode picker returns. Choose `Free space install` again → the same not-enough-space screen; choose `Back` → mode picker. Escape to abort; on the shell `lsblk /dev/vda` → unchanged.
  ** Other variants: a BitLocker-protected partition (bytes 3–10 of the partition read `-FVE-FS-`) → `BitLocker signature detected on /dev/vdaN.` and `Aborted: BitLocker is enabled on this disk.` (the manual's wording: `Suspending BitLocker is not enough — the drive stays encrypted.`); with the `--gap` fixture (slot 3 deleted, slot 4 in use) the new partitions must come out as 3 and 5 (the partition-numbering regression).
  * End with `./client stop`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * On the resumed single-OS minted disk only the `limine-scan` finds-nothing path is runnable; everything above needs the fixture.
  * Limine's menu is normally not shown at boot (`default_entry: 2`); if no menu appears on the reboot, prove the second entry from `sudo grep -E '^/' /boot/limine.conf` instead and report what the boot showed. Screenshot repeatedly through the reboot.
  * cfdisk is a full-screen TUI; `q` quits without writing — never press `W`.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the mode picker (and the return from `Choose a different disk`), the Windows-ESP message, the free-space confirm with the encryption toggle both ways, the partition steps, and the post-boot `lsblk`/marker/limine/findmnt/crypttab output; Limine with both entries (or `limine.conf` listing both) after `limine-scan`
  ** On the too-small fixture: the not-enough-space screen with the exact size, the partition-tool prompt, cfdisk, the return to the picker after `q` and after `Back`, and the untouched `lsblk`; on the BitLocker fixture: the signature/abort lines
  * If unsuccessful
  ** Screenshot of a full-disk wipe when free-space was chosen, the option missing, BitLocker not detected, `Not enough free space` on the large fixture, the install proceeding despite < 32 GiB, the wizard crashing out of cfdisk, a `disk_abort_hook` failure (`Could not create the EFI partition`), or the marker file missing; `cat /var/log/omarchy-install.log | sudo tee /dev/ttyS0` and `./client get-serial`
covers: configurator install_mode_form/run_partition_decide/run_partition_execute/detect_windows_esp, configurator not_enough_space/open_partition_tool/detect_bitlocker, configurator (free space, BitLocker, encryption Ctrl+C), disk-partitioning.sh, orchestrator prepare_install_target/_install_pre_mounted_limine/_write_pre_mounted_fstab/_write_pre_mounted_crypttab/_validate_pre_mounted_filesystems, manual/50, manual/50 (Bitlocker), manual/02:3, manual/02:35, omarchy-iso-test-windows-disk, partition-numbering-test.sh
merged-from: 42:install-free-space-alongside-windows-esp; 13:install-free-space-dual-boot; 42:install-free-space-too-small-offers-partition-tool

### install-gaming-battlenet   [VM-NO] [NET] [SLOW]
description: `Install → Gaming → Battle.net` downloads the installer and runs it under umu/GE-Proton in the background, adds a launcher entry, and removal wipes the prefix while asking about umu and GE-Proton. Not runnable here: a GPU-less machine is meant to continue (the `omarchy-install-gaming-gpu-lib32` helper is a documented no-op "otherwise" — DEFECT #1 in 03-INTENDED-BEHAVIOUR: at HEAD it exits 1 under `set -e` and the Float ends `Failed (exit code 1)` before any download), and the full path then needs ~500 MB of runtimes and a GPU to run the wizard, beyond the session budget; no harness change short of GPU passthrough makes it runnable. On the minted disk only the helper's exit status is observable. Sibling of the F1 gaming-install appendix entries (Steam, RetroArch, Lutris, Heroic, GeForce NOW).
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Menu (Super+Space) → `Install` → `Gaming` → `Battle.net`; sudo password `prime`; wait for `Downloading Battle.net installer...`, the wizard note, `The Battle.net installer is running in the background...` and `Done!`.
  ** Intended on a machine with no Intel/AMD/NVIDIA GPU (this guest): the gpu-lib32 step is a no-op and the download begins. Observed at HEAD: the Float ends `Failed (exit code 1)` from the helper before any download — that is defect #1; screenshot it, then in a terminal `omarchy-install-gaming-gpu-lib32; echo "exit=$?"` (intended `exit=0`, HEAD `exit=1`) and stop.
  * Screenshot the Battle.net setup wizard as it appears; click through it with defaults.
  * Open Apps (Super+Alt+Space), type `battle` → `Battle.net` listed; Menu → Install → Gaming: `Battle.net` dim ✓.
  * Menu → Remove → Gaming → `Battle.net` → Float: `Battle.net and its Proton prefix at ~/Games/battlenet have been removed.`, then `Also remove umu-launcher?` **Yes** and `Also remove GE-Proton runtimes downloaded by umu?` **Yes**, `Done!`.
  * Apps → `battle` → gone; open a terminal with Super+Enter and type `ls -d ~/Games/battlenet 2>&1` → `No such file`. Close the terminal; the desktop is as found.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Re-running Install after an interrupted wizard asks `Wipe the partial prefix and start fresh?`; answer Yes to retry.
  * Menu guards paint from the previous open — reopen the menu twice before asserting the dim ✓ moved or the row disappeared.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The installer's messages and `Done!`; the wizard; the launcher entry and dim row; the removal messages with both Yes answers; the prefix gone
  * If unsuccessful
  ** The `Failed (exit code 1)` banner with `omarchy-install-gaming-gpu-lib32; echo "exit=$?"` → `exit=1` (defect #1: intended `exit=0` no-op; flag, do not treat as a Battle.net regression), or `/tmp/omarchy-battlenet-installer.log` read via `cat /tmp/omarchy-battlenet-installer.log | sudo tee /dev/ttyS0` and `./client get-serial`
covers: bin/omarchy-install-gaming-battlenet, bin/omarchy-remove-gaming-battlenet, bin/omarchy-install-gaming-gpu-lib32, test/shell.d/battlenet-test.sh
merged-from: 23:install-gaming-battlenet

### iso-install-too-small-disk-fails-in-package-phase   [VM-NO]
description: A full-disk install onto a disk too small for the package set (about 8 GiB) must fail inside the package phase and land on the failure screen with a readable `No space left on device` cause rather than a half-written disk that offers `Reboot Now`; the configurator has no disk-size check, so this documents the failure mode rather than a validation. Needs harness support: a small disk image passed at `./client start` (`--disk <8G qcow2>`) instead of the standard 40 GB; the driver cannot choose the disk size today, so this stays `VM-NO` even from an ISO ticket. The disk is altered: `stop` is required.
instruction: |
  <Instructions>
  From the desktop please do the following:
  (ISO ticket with `--disk <8G qcow2>`: a blank 8 GiB disk in place of the 40 GB default. "The desktop" is the ISO's tty1; no install completes.)

  <ActionList>
  * Greeter → Enter; keyboard → Enter; form with defaults (`Username>` `small`, `prime`/`prime`, Enter, Enter, Enter, Enter); review `Yes`.
  * The disk picker shows `/dev/vda (8G)` and nothing else; Enter. At the confirm press Enter on `Yes, install` (encrypted).
  ** There is no disk-size warning at the picker or the confirm — record that the install starts.
  * The dashboard runs `Installing Arch + Omarchy` (screenshot every 5 s) until pacman hits `No space left on device`; the failure screen shows `Omarchy installation stopped`, `Installer exited with status 1`, `failed phase: Installing Arch + Omarchy: …`, and the `Last log lines:` tail with the ENOSPC line. No media diagnosis is printed (the failure is not a corrupted package).
  * Choose `View full log` → `less` on `/var/log/omarchy-install.log`; find the `No space left on device` error; press `q` → the failure screen is redrawn.
  * Choose `Drop to shell` → root prompt; `lsblk -f /dev/vda` shows the partial layout (partitions and filesystems created, install incomplete). End with `./client stop`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Do not choose `Upload log for support` (public paste service) or `Reboot`/`Power off` (they end the session).
  * The failure text is centred and truncated to the logo width; the `failed phase:` line may be cut with `…` — the full log has the whole line.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the `/dev/vda (8G)` picker, the dashboard, the failure screen naming the package phase and the ENOSPC log line, `less` with the error, and the partial `lsblk` layout from the shell
  * If unsuccessful
  ** Screenshot of the installer finishing and offering `Reboot Now` on an 8 GiB disk, or hanging without a failure screen; from the shell `tail -30 /var/log/omarchy-install.log` (screenshot, or `> /dev/ttyS0` then `./client get-serial`)
covers: omarchy-install-dashboard failure path, orchestrator arch_install_system, omarchy-install-diagnose-media (no verdict for non-media failures), configurator (no size validation)
merged-from: 42:install-too-small-disk-fails-cleanly

### omarchy-mac-apple-silicon-guide   [VM-NO]
description: Omarchy on Apple hardware, both paths: the Intel Mac install (manual/44 — Secure Boot off in recovery, Option-boot the USB, automatic Broadcom/SPI/NVMe/T2 fixes from `install/hardware/apple/*.sh`, with the documented T1 limitations: no Touch Bar or sound) and omarchy-mac, the Asahi Alarm + Omarchy dual-boot guide for M1/M2 Macs linked from the manual's "Omarchy on…" page (aarch64, no x86 path). Not runnable here: needs Apple hardware (an Intel Mac, or Apple Silicon); no harness change on x86 QEMU makes either runnable — the `omarchy-hw-match` predicates that select the Apple fixes never fire on virtio hardware. The only in-guest check is that the manual pages exist and link to the guide (documentation, not a behaviour). Appendix entry for the record.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Not runnable here (Apple hardware only). The only in-guest check is that `Learn → Omarchy` opens the manual whose "Omarchy on…" page links to the omarchy-mac guide and whose chapter 44 describes the Intel Mac install; screenshot them if those manual pages are reached in another test.
  * For the record, Intel Mac (manual/44): disable Secure Boot in recovery, Option-boot the USB, install from the ISO as on any machine.
  * For the record, after first boot on an Intel Mac open a terminal with Super+Enter: T2 models — `pacman -Q linux-t2 t2fanrd; uname -r` show the T2 kernel, and Wi-Fi, Bluetooth, audio and the Touch Bar work; T1 models — Touch Bar and sound absent (documented); all — keyboard works (SPI fix) and suspend/resume works (NVMe fix); Limine prefers `linux-t2` (`etc/limine-entry-tool.d/omarchy-defaults.conf` BOOT_ORDER).
  * For the record, Apple Silicon: follow the omarchy-mac guide (Asahi Alarm first, then Omarchy alongside macOS).
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Appendix entry only. `omarchy-hw-match` predicates in `install/hardware/apple/*.sh` decide which fixes apply; on the QEMU guest none match.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Not applicable on this harness (the manual page screenshots, if taken). On Apple hardware: photos/screenshots of the recovery settings, the EFI Boot pick, and the post-install package/kernel checks
  * If unsuccessful
  ** Not applicable here. On Apple hardware: missing Wi-Fi/keyboard, wrong kernel on T2, or Limine not preferring `linux-t2`
covers: manual/49-omarchy-on.md l.5; omarchy-mac README; manual/44; install/hardware/apple/*.sh; etc/limine-entry-tool.d/omarchy-defaults.conf BOOT_ORDER
merged-from: 60:omarchy-mac-apple-silicon; 13:mac-install-and-known-limitations

### try-omarchy-host-apps-macos-and-windows   [VM-NO]
description: Try Omarchy (macOS) and Try Omarchy for Windows run Omarchy inside a host-native app — first-run image download, then the Omarchy desktop with an instant trial login, fullscreen toggle, shared clipboard and a shared folder. Not runnable here: they need a Mac or Windows host and cannot run inside the Linux guest; no harness change makes them runnable. Appendix entry for the record.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Not runnable here (host-side applications; nothing in the guest exercises them).
  * For the record, macOS: open `Try Omarchy.app`; the first run downloads the image; the Omarchy desktop appears in the app window.
  * For the record, Windows: run `TryOmarchy.exe`, enable Hypervisor Platform when asked, let it download the image; the Omarchy 4.0.3 desktop appears with the instant trial login `omarchy` / `omarchy`.
  * For the record, inside the trial: `Ctrl+Alt+F` toggles fullscreen; the clipboard is shared with the host; the `Omarchy Shared` folder maps to the host.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Appendix entry only.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Not applicable on this harness
  * If unsuccessful
  ** Not applicable
covers: try-omarchy README; try-omarchy-windows README
merged-from: 60:try-omarchy-macos-and-windows

## Moved to other domains

- 12:theme-install-rejects-bad-name-and-url → E — `VM-OK` theme-install URL/name guard on the minted disk (`ext::`, `gopher://`, unusable name, clone failure); same story as E's 52:theme-install-refuses-hostile-urls-and-names, not an ISO path.
- 21:theme-install-rejects-bad-urls → E — same story (adds `..git` name refusal and the `omarchy-theme-current` → `Tokyo Night` round-trip check).
- 60:theme-install-rejects-bad-url → E — same story (`ext::`, `%20` name, non-existent GitHub repo).
- 61:theme-install-rejects-bad-url → E — same story (adds `--upload-pack=` option-shaped refusal, the no-argument gum URL prompt cancelled with Escape, and the `Install → Style → Theme` menu route).
- 11:webapp-install-rejects-bad-input → F1 — `VM-OK` web-app install validation on the minted disk (`/` in name, non-http scheme, whitespace URL, icon download failure, false-success `webapp remove`); same story as F1's 52:webapp-install-refuses-bad-urls-and-names (removal half with 22:webapp-remove-via-menu-and-cli), not an ISO path.
- 22:webapp-install-rejects-bad-input → F1 — same story via the `Install → Web App` menu route plus the empty launcher search.

## Dropped

None.
