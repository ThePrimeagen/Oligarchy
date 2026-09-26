# Intended behaviour: settling the manual-vs-code disagreements

Scope: every bullet (and sub-item) of `02-PREAMBLE.md` § "Defects and doc/code disagreements found by
reading", plus the five orchestrator questions (a)–(e) and two extra manual disagreements from
`01-FACTS.md` [11] (appendix). Source: full-history clone of `omacom/omarchy` @ `d174d4a`
(2026-09-18; tags `v4.0.2` = 346e69e1 2026-08-30, `v4.0.4` = c668141e 2026-09-14) and `omacom/omarchy-iso`
@ `7cfb711`. Every file:line is at HEAD unless a sha is given. GitHub state checked 2026-09-18 via the REST
API (issue/PR numbers below are `omacom/omarchy`).

Verdict key: **CODE-INTENDED** (manual stale; test asserts code; manual needs update) ·
**MANUAL-INTENDED** (code regressed/never implemented; test asserts manual; defect) · **DEFECT** (no
doc either way, behaviour clearly wrong) · **UNCLEAR** (record observed; flag for maintainers).

Counts (30 items): CODE-INTENDED 15 · MANUAL-INTENDED 1 · DEFECT 11 · UNCLEAR 3. Questions (a)/(b) both
resolve CODE-INTENDED; (c)/(d)/(e) are items 10/12/11.

## Summary table

| # | Item | Verdict | Test asserts |
|---|------|---------|--------------|
| 1 | `omarchy-install-gaming-gpu-lib32` exits 1 with no GPU | DEFECT | Intended: exit 0 no-op so Steam/Lutris/Heroic/Battle.net continue. Observed HEAD: `exit=1`, callers end `Failed (exit code 1)`. Record both; flag. |
| 2 | `sshd --key=<bad>` enables sshd + opens 22 before validating | DEFECT | Intended: `Not a valid SSH public key`, exit 1, sshd still disabled, no `22/tcp` rule. Observed HEAD: sshd `enabled`+active, `22/tcp LIMIT`, passwords on. |
| 3 | Unattended `authorized_keys` uses `ufw allow`, not `limit` | CODE-INTENDED | `ufw status` → `22/tcp ALLOW IN Anywhere`; `sshd -T` still `passwordauthentication yes` (manual 51:27 says exactly that). |
| 4 | `omarchy-snapshot <unknown>` exits 0 silently | DEFECT | Intended: usage on stderr, non-zero. Observed HEAD: no output, `exit=0`. |
| 5 | `omarchy-install-dev-env <unknown>` succeeds silently | DEFECT | Intended: `Unknown environment: <x>` exit 1 (as the remover does). Observed HEAD: silent `exit=0`. |
| 6 | `omarchy-install-docker-dbs` Escape → undefined `main_menu` | DEFECT | Intended: quiet `No databases selected for installation.` exit 0. Observed HEAD: `main_menu: command not found` on stderr first. |
| 7 | `Super+Ctrl+Alt+B` empty-headline toast without battery | DEFECT | Intended: no toast or a `No battery` headline. Observed HEAD: toast with glyph 󰁹 and empty text. |
| 8 | `omarchy theme remove` deletes the *active* user theme | DEFECT (regression) | Intended (pre-2026-01-03 code): switch theme first / refuse. Observed HEAD: dir removed, `omarchy theme current` still names it, `omarchy-theme-set <same>` → does not exist. |
| 9 | `omarchy-upgrade-to-quattro` has no "already on 4.x" guard | UNCLEAR | Decline at `Continue with upgrade?` → exit 0, no `.omarchy-upgrade-to-quattro.*.bak`, hash unchanged; record that no "already Quattro" notice exists. Never answer Yes. |
| 10 | `omarchy update -y` still asks `Reboot?` | MANUAL-INTENDED | Intended: `-y` never prompts (skips reboot with a printed line). Observed HEAD: `gum confirm "Linux kernel has been updated. Reboot?"` (issue #8986, PR #8992 open). |
| 11 | Phantom `finalize` group in `omarchy --help` | DEFECT | `omarchy provision user --help` exit 0; `omarchy finalize user` → `Unknown Omarchy command`, exit 127; `omarchy --help` lists `finalize` (record; issue #7113 open, also `branch config wifi`). |
| 12 | `omarchy help` is not a command | CODE-INTENDED | `omarchy help` → `Unknown Omarchy command: omarchy help`, exit 127; `omarchy`, `omarchy --help`, `omarchy -h` → `Omarchy command center`, exit 0. |
| 13 | Tailscale install blocks at `sudo tailscale up`; Ctrl+C kills setup | CODE-INTENDED (+ minor DEFECT) | URL `https://login.tailscale.com/a/…` printed and the command waits; after abort `tailscale status` → `Logged out.`, `tailscaled` active, Install row dim (cannot re-run from menu), Remove row present. |
| 14 | Manual: `Super+Ctrl+Alt+W` = notification (code: panel) | CODE-INTENDED | Chord toggles the weather **panel** layer; no toast. |
| 15 | Manual: clipboard `Return` = clipboard-only (code: pastes) | CODE-INTENDED | `Return` pastes into the focused window (Shift+Insert); `Shift+Return` copies only. |
| 16 | Manual: emoji picker copies (code: inserts) | CODE-INTENDED | Emoji appears in the focused window; clipboard content and history unchanged afterwards. |
| 17 | Manual: `Super+Shift+B` undocumented | CODE-INTENDED | `Super+Shift+B` opens the default browser (Chromium), same as `Super+Shift+Return`. |
| 18 | Manual previews 19 of 22 themes | CODE-INTENDED | Theme picker lists 22 entries incl. `last-horizon`, `lupine`, `solitude`; manual gap only. |
| 19 | Manual: "processes restart after editing" (explicit restarts only Hyprsunset/XCompose) | CODE-INTENDED (manual true in effect) | Save in `Setup → Monitors` applies without `hyprctl reload` (Hyprland autoreload); `Setup → Config → Hyprsunset` runs `omarchy-restart-hyprsunset` on quit. |
| 20 | Manual "2x" vs shipped `omarchy_monitor_scale = "auto"` | CODE-INTENDED | `monitors.lua` has `"auto"` and `omarchy_gdk_scale = 2`; `hyprctl monitors` scale `1.00` on 1280×800. |
| 21 | `Update → Config` restores groups, `.bak.<epoch>` | CODE-INTENDED | `Update → Config → Hyprland` rewrites all 7 `~/.config/hypr` files; only changed files get `<file>.bak.<epoch>`. |
| 22 | faillock / LUKS try limits unstated | CODE-INTENDED (doc gap) | 10th wrong lock-screen password → `Authentication failed`, correct password refused until 120 s; LUKS: never 3 wrong tries (upstream initramfs limit). |
| 23 | hype/owe READMEs give impossible install commands | DEFECT (docs, other repos) | `omarchy pkg add owe` → pacman `target not found: owe`, exit 1; `Install → AUR → owe` builds; `hype` absent from OPR and AUR-`hype` is unrelated. |
| 24 | elsewhen package path not scanned by the plugin catalog | UNCLEAR (pending PR #12051) | `omarchy plugin add https://github.com/omacom/elsewhen.git --enable` works; after `pacman -S elsewhen` alone, `omarchy plugin list` does **not** show `omacom.elsewhen` at HEAD (record). |
| 25 | `agent` group description wrong | DEFECT (stale string) | `omarchy agent --help` → `Launch the default coding agent…`; `omarchy --help` agent line currently `AI coding agent usage data` (record). |
| 26 | Menu extension JSONC: one inline `//` drops every user entry | CODE-INTENDED (documented limitation) | Inline `//` → all user rows vanish, shipped rows stay, no toast; whole-line `//` comments are fine. |
| 27 | `omarchy refresh config ../…` path escape | DEFECT (documented-known) | Intended: rejected. Observed HEAD: `omarchy refresh config ../default/bashrc` → `exit=0`, `~/default/bashrc` created. |
| 28 | `Setup → Plugins → Clone` opens `$EDITOR`, not the default editor | CODE-INTENDED | Clone opens the clone dir in the **default editor** (nvim) — `$EDITOR` is `omarchy-launch-editor --inline` on Omarchy. |
| 29 | Many Install rows have no Remove counterpart | UNCLEAR (1Password sub-item DEFECT) | `Remove → Services` shows only Dropbox/Tailscale when present; `omarchy remove service 1password` exists via CLI but has no row. |
| 30 | Apps-menu `Delete` leaves `~/.config` behind | CODE-INTENDED | `Delete` → confirm → floating `Uninstalling <App>…` → `pacman -Rns`; package gone, `~/.config/<app>` remains (expected). |
| (a) | `Super+Escape` = System submenu, not "Omarchy Menu" | CODE-INTENDED | `Super+Escape` opens the **System** submenu (Screensaver, Lock, Suspend, Logout, Reboot, Shutdown); root menu is `Super+Space`. |
| (b) | Lock screen has no clock | CODE-INTENDED | Lock screen shows only the password field (`Enter Password` / `Checking…` / `Authentication failed (N)`); no clock, no user name. |
| A1 | Manual: `Setup → Defaults → Browser` lists installed only | CODE-INTENDED | All browser rows listed regardless; picking an uninstalled one starts its installer. |
| A2 | Manual: `Super+Shift+G` "offers to install" Signal | CODE-INTENDED | Chord opens the floating installer immediately (`Installing Signal…`, sudo prompt is the only back-out). |

---

## 1. `omarchy-install-gaming-gpu-lib32` exits 1 with no Intel/AMD/NVIDIA GPU

- **Code**: `bin/omarchy-install-gaming-gpu-lib32:30` — `(( ${#PACKAGES[@]} > 0 )) && omarchy-pkg-add …` is the
  last statement; with an empty array the `&&` list yields status 1 and the script exits 1. Callers
  `bin/omarchy-install-gaming-{steam,lutris,heroic}:10` and `…-battlenet:15` run it under `set -e`.
- **Doc**: `manual/26-gaming.md:7` ("All gaming installers live under Install > Gaming"); no doc covers
  GPU-less machines. The script's own original summary: "Install lib32 Vulkan drivers for any detected
  Intel/AMD GPUs **(no-op otherwise)**".
- **History**: 42034a95 (2026-05-03, DHH, "Add Battle.net installer via Lutris") created
  `omarchy-install-vulkan-lib32` with the `[[ … -gt 0 ]] && …` tail and the "(no-op otherwise)" summary,
  already called from `omarchy-install-steam` under `set -e`; d0e3e76d (2026-05-04) collapsed it into
  `omarchy-install-gpu-lib32`; fed22982 (2026-05-21, "Consistency") switched to `(( ))`; 8914d30b
  (2026-05-27) renamed to `gaming-gpu-lib32`. The exit-1 leak has been present from day one. Open PR
  #8875 (2026-08-29, "Install lib32 GPU drivers before Steam", fixes #8856) moves the call *before*
  `omarchy-pkg-add steam` and would make the abort happen even earlier; nothing on GitHub addresses the
  exit status.
- **Verdict**: **DEFECT** — the author's stated intent is "no-op otherwise"; exit 1 is an artefact of the
  `&&` idiom under `set -e`.
- **Test**: proof records `omarchy-install-gaming-gpu-lib32; echo exit=$?` → intended `exit=0`; at HEAD
  `exit=1`, and `Install → Gaming → Steam` (NET, big) ends `Failed (exit code 1)` before `steam` is
  launched. Assert the intended no-op; flag the observed abort as the defect.

## 2. `omarchy-setup-security-sshd --key=<bad>` enables sshd and opens 22 before validating

- **Code**: `bin/omarchy-setup-security-sshd:192-197` — `setup_sshd` (pkg-add, `systemctl enable --now
  sshd`), `open_firewall` (`ufw limit 22/tcp`) run first; `authorize_key "$KEY" || exit 1` validates at
  :84 only afterwards; `disable_password_auth` (:148) is never reached, so passwords stay on.
- **Doc**: `manual/48-security.md:6` and `manual/35-networking.md:33`: "ssh is off until you turn it on via
  Setup > Security > SSHD". The script's own comment (:14-17) states the design rule: reject bad input
  "before anything is installed or opened".
- **History**: 72d7646c (2026-07-18, DHH) added the command with this order; 33cda8b6 (2026-08-16, PR #7086,
  "Add --gh-keys so sshd setup can run without prompts") explicitly fixed the same ordering bug for
  `--gh-keys` ("Reject a missing --gh-keys username before setting anything up … a help flag that changes
  the system") but left `--key` validated late; df819a6f (2026-08-30, Ryan Hughes) added the
  password-auth hardening after the key step. `test/shell.d/setup-security-sshd-test.sh` never feeds an
  invalid `--key`.
- **Verdict**: **DEFECT** — the project's own fix for `--gh-keys` states the intent; `--key` was simply
  missed.
- **Test**: `omarchy-setup-security-sshd --key="not-a-key"; echo rc=$?` → intended: `Not a valid SSH public
  key: not-a-key`, `rc=1`, `systemctl is-enabled sshd` → `disabled`, `sudo ufw status | grep 22` empty.
  Observed HEAD: same message and `rc=1` but sshd `enabled`/`active`, `22/tcp LIMIT`, no
  `~/.ssh/authorized_keys`, `sshd -T` still `passwordauthentication yes`. Clean-up via
  `omarchy-remove-security-sshd`.

## 3. Unattended `authorized_keys` uses `ufw allow`, not `ufw limit`

- **Code**: `omarchy-iso configs/airootfs/usr/share/omarchy-iso/orchestrator/phases_impl.py:1456-1524`
  (`configure_ssh_access`): `arch-chroot … ufw allow ssh`, then asserts `--dport 22 -j ACCEPT` in
  `user.rules`; nothing touches password auth.
- **Doc**: `manual/51-unattended-installs.md:27`: "enables `sshd`, and opens the firewall for it … The
  install only adds your keys — it doesn't loosen any of the SSH daemon's other authentication settings."
  The rate-limit language in `manual/48-security.md:6` describes the *Setup > Security > SSHD* path.
- **History**: iso repo history is squashed into the merge 7cfb711 (2026-09-14); the code comment
  explains the `allow` choice (chroot cannot reach netfilter; the rule file is what matters). The manual
  text was written with the feature (manual 51 imported 929849c7 2026-08-13 and updated with #6621-era
  provisioning). Both sides agree.
- **Verdict**: **CODE-INTENDED** — the two paths differ by design and the unattended chapter documents
  `allow`; only the *reviewer's* expectation of `limit` was wrong. Note for maintainers: the unattended
  path does not harden passwords, so a cidata install is weaker than the menu path.
- **Test** (ISO-only): after a cidata install `sudo ufw status | grep 22` → `22/tcp ALLOW IN Anywhere`;
  `sshd -T | grep -i passwordauth` → `passwordauthentication yes`.

## 4. `omarchy-snapshot <unknown>` exits 0 silently

- **Code**: `bin/omarchy-snapshot:20-49` — `case "$COMMAND" in create) … restore) … esac` with no `*)`;
  header `omarchy:args=<create|restore>` (:4). Empty arg → usage exit 1 (:11-14); `snapper` missing →
  exit 127 (:16-18).
- **Doc**: `docs/update-process.md:129-131` describes only create; router usage advertises `<create|restore>`.
- **History**: the `case` shape dates from d2a4cc0c (2026-05-01, Ryan Hughes, "Add omarchy CLI (#5477)") /
  671dd469 (2026-05-17). 3bfea9b8 (2026-08-07, Nille af Ekenstam, PR #6580 "Fail loudly when a
  pre-update snapshot isn't actually created") states the project's principle — "Staying quiet here reads
  as a successful snapshot" — but only for the no-configs case. No GitHub issue on the typo case.
- **Verdict**: **DEFECT** — a typo passes silently in a command whose maintainers just made the sibling
  no-op loud.
- **Test**: `omarchy-snapshot bogus; echo exit=$?` → intended `Usage: omarchy-snapshot <create|restore>`
  on stderr and `exit=1`; observed HEAD: no output, `exit=0`. `omarchy snapshot` (no arg) → usage, `exit=1`
  (already correct).

## 5. `omarchy-install-dev-env <unknown>` succeeds silently

- **Code**: `bin/omarchy-install-dev-env:53-155` — `case "$1"` with 18 branches and no `*)`; ends exit 0.
  Its remover `bin/omarchy-remove-dev-env:107-110` has `*) echo "Unknown environment: $1"; exit 1`.
- **Doc**: the script's own usage line (:10) and `omarchy:args` (:5) enumerate the accepted set.
- **History**: installer shape from ca406766 (2026-01-05) / 7514ae7d (2026-02-21); the remover's guard has
  existed since it was added in 941e1c2d (2026-01-03, Justin Mißmahl, PR #4065 "omarchy remove dev").
- **Verdict**: **DEFECT** — the sibling remover shows the intended shape.
- **Test**: `omarchy install dev-env bogus; echo exit=$?` → intended `Unknown environment: bogus`,
  `exit=1`; observed HEAD: nothing printed, `exit=0`. `omarchy remove dev-env bogus` → `Unknown
  environment: bogus`, `exit=1` (correct today).

## 6. `omarchy-install-docker-dbs` on Escape calls undefined `main_menu`

- **Code**: `bin/omarchy-install-docker-dbs:9` — `choices=$(… gum choose …) || main_menu`. No `set -e`, so
  after `bash: main_menu: command not found` the script falls to :27 `No databases selected for
  installation.` and exits 0.
- **Doc**: none (menu row `install.development.docker-dbs`).
- **History**: de1330cd (2025-08-04, DHH, "Add standalone script for setting up the docker DBs — So we can
  use it via the new menu system") copied the line out of the old bash `omarchy-menu`, where `main_menu`
  was a function; it has been dead in the standalone script ever since. Closed-unmerged PR #5065
  (2026-03-19, "fix: correct 8 shell script bugs") listed it: "`main_menu` function not in scope when run
  via `present_terminal`".
- **Verdict**: **DEFECT** (cosmetic; harmless).
- **Test**: `Install → Development → Docker DB`, press Escape → intended: only `No databases selected for
  installation.`; observed HEAD: `…/omarchy-install-docker-dbs: line 9: main_menu: command not found`
  followed by that line; either way the floating terminal closes on a key, nothing installed.

## 7. `Super+Ctrl+Alt+B` sends an empty-headline toast on battery-less machines

- **Code**: `default/hypr/bindings/utilities.lua:94` → `bin/omarchy-notification-battery:5`
  (`omarchy-notification-send -g 󰁹 -u low "$(omarchy-battery-status)"`); `bin/omarchy-battery-status:26-27`
  exits 0 with empty stdout when `upower -e` lists no `BAT`. `omarchy-notification-send` accepts `""` as a
  headline (it only checks `$# < 1`).
- **Doc**: `manual/07-hotkeys.md:210` — "Show battery as notification"; nothing about machines without one.
- **History**: ba201808 (2025-10-23, DHH, "Provide time and battery notifications for when you're running
  without the waybar") bound `notify-send "󰁹 Battery is at $(omarchy-battery-remaining)%"` — degenerate
  but never empty. 35cf232b (2026-05-14, "Extract built-in notifications") created
  `omarchy-notification-battery` around `omarchy-battery-status`; d9622d6b (2026-05-21, "Extract shell
  panel status commands") added `[[ -z $battery ]] && exit 0` for the *panel's* benefit. The combination
  produces the empty toast; no commit intends it. The menu hides battery rows behind
  `omarchy-battery-present`, the hotkey has no such guard.
- **Verdict**: **DEFECT**.
- **Test**: press `Super+Ctrl+Alt+B` on the VM → intended: no toast, or a toast whose headline reads e.g.
  `No battery`; observed HEAD: a low-urgency toast with the 󰁹 glyph and no text. Screenshot both ways;
  `omarchy-battery-status; echo exit=$?` → empty, `exit=0`.

## 8. `omarchy theme remove` deletes the active user theme with no guard

- **Code**: `bin/omarchy-theme-remove:30-39` — existence, dot/slash checks, then `rm -rf "$THEME_PATH"`;
  no comparison with `~/.local/state/omarchy/current/theme.name` (`bin/omarchy-theme-current:6`). The
  rendered copy in `~/.local/state/omarchy/current/theme` keeps the desktop alive, but
  `omarchy-theme-set`/`omarchy-theme-refresh` for that name fail afterwards.
- **Doc**: none in `manual/` (theme removal is not described).
- **History**: d1b09e27 (2025-08-05, DHH, "Add remove menu and tune up theme-remove script") shipped a
  guard: "Move to the next theme if the current theme is the one being removed" → `omarchy-theme-next`.
  4a07b94c (2026-01-03, DHH, PR #4053 "Use theme config templates…") deleted `omarchy-theme-next` ("No
  longer need omarchy-theme-next since themes are now fully rendered, not symlinks") and removed the
  guard with it instead of rewriting it; 0f5e8114 (2026-06-09) dropped the now-unused `CURRENT_DIR`. No
  GitHub issue found.
- **Verdict**: **DEFECT (regression)** — the guard was intended and lost as collateral of a refactor.
- **Test**: install a user theme (offline `file://` git repo), `omarchy theme set <it>`, then `omarchy
  theme remove <it>; echo exit=$?` → intended: refusal (`… is the active theme`) or an automatic switch
  before removal. Observed HEAD: `Removed <it>`, `exit=0`, `omarchy theme current` still prints `<it>`,
  `omarchy-theme-set <it>` → `Theme '<it>' does not exist`. Restore with `omarchy theme set tokyo-night`.

## 9. `omarchy-upgrade-to-quattro` has no "already on 4.x" guard

- **Code**: `bin/omarchy-upgrade-to-quattro:334-354` — banner + `gum confirm "Continue with upgrade?" || exit
  0` is the only gate; no check of `pacman -Q omarchy` / `/usr/share/omarchy`. :377 tells a failed run
  "Re-running is safe and resumes the remaining steps."; :1200-1207 "Rerun the upgrade before rebooting."
- **Doc**: `docs/testing.md:134`, `agents/skills/migrations.md:168` (the upgrade path); no doc promises a
  refusal on 4.x.
- **History**: 428b9c7b (2026-06-21, DHH) introduced the script; 0b7c4400 (2026-07-17) added the gum consent;
  40d0c9bb (2026-08-30, Ryan Hughes, "Require Quattro migrations to complete") made re-running the
  documented recovery path. The absence of a guard is therefore load-bearing: a hard "already Quattro"
  refusal would break resuming a half-finished upgrade.
- **Verdict**: **UNCLEAR** — no doc either way, and the re-run design argues against a hard guard; a
  *warning* ("this machine already appears to be on Quattro") would not conflict. Flag for maintainers.
- **Test**: run `omarchy-upgrade-to-quattro` on the 4.0.2 disk, answer **No** → `exit=0`,
  `sha256sum /etc/pacman.conf` unchanged, no `/etc/pacman.conf.omarchy-upgrade-to-quattro.*.bak`, no new
  snapshot; record that no "already on Quattro" line appeared. Argument refusals (`--channel nightly`,
  `--bogus`) exit 1 before the banner. Never answer Yes.

## 10. `omarchy update -y` still asks `Reboot?` — question (c)

- **Code**: `bin/omarchy-update:25-29` exports `OMARCHY_UPDATE_UNATTENDED=1` for `-y` ("a promise not to ask
  anything"); `bin/omarchy-update-restart:7-9,26,28,33` — `confirm_reboot() { gum confirm "$1" && …; }`
  ignores the variable. `bin/omarchy-update-orphan-pkgs:15-21` also ignores it (tty check only). Only
  `bin/omarchy-update-system-pkgs-when-conflicted:74` honours it.
- **Doc**: `docs/update-process.md:145-147`: "`-y` exports `OMARCHY_UPDATE_UNATTENDED=1` — a promise not to
  ask anything. Steps that would prompt (orphan removal, conflict handoff) report and skip instead of
  blocking." Same file :294 still describes `omarchy-update-restart` as "Prompts for reboot".
  `test/shell.d/update-package-conflict-test.sh:153`: "-y is kept: an unattended update never waits on an
  answer".
- **History**: the promise was written in 5ca3030c (2026-08-14, DHH, PR #6830 "Put a blocked package
  upgrade back to whoever is updating") and documented in f4189398 (2026-08-15). `omarchy-update-restart`
  last changed 47fa3ce3 (2026-08-08) — before the promise — and was never taught the flag. GitHub: issue
  #8986 (2026-08-29, "`omarchy update -y` can block at the post-update reboot prompt") and PR #8992 ("Skip
  reboot prompts in unattended updates") open; issue #8780 / PR #8824 cover the orphan prompt; PR #11018
  "Support scripted updates" open. None merged at d174d4a.
- **Verdict**: **MANUAL-INTENDED** — the doc and the maintainers' own test state the contract; two
  downstream steps never implemented it.
- **Test**: `omarchy update -y` on the un-rebooted post-update disk → intended: no `gum confirm`; a printed
  line that a reboot is required, `Done!`, `exit=0`. Observed HEAD: `Linux kernel has been updated.
  Reboot?` box (and, with orphans present, `Remove N orphaned package(s)?`). Answer No; record the prompt
  as the defect.

## 11. Phantom `finalize` group in `omarchy --help` — question (e)

- **Code**: `bin/omarchy:45` `GROUP_DESCRIPTIONS[finalize]="Finalize user setup"`; `show_group_list`
  (:509-516) prints every described group regardless of commands. The binary is
  `bin/omarchy-provision-user` (`omarchy:hidden=true`, :4) whose own usage text (:10) still says `Usage:
  omarchy finalize user`. The router derives the route from the file name → `omarchy provision user`
  (visible with `omarchy commands --all`); `omarchy finalize`/`omarchy finalize user` → exit 127. Same
  phantom state for `branch`, `config`, `wifi` (checked: described groups with zero commands at HEAD);
  `provision`, `show`, `upgrade` route but have no description.
- **Doc**: `docs/file-layout.md:39-40` "`omarchy-provision-user` (routed as `omarchy finalize user`)";
  `agents/skills/install-scripts.md:10` still names `bin/omarchy-finalize-user`.
- **History**: babfafa5 (2026-05-27, Ryan Hughes, "Split user defaults into skel seed, finalize, and
  resync") added `omarchy-finalize-user` and the group line. 6fa4f78e (2026-08-09, DHH, PR #6621 "Add
  deferred first-boot provisioning and factory reset") renamed `omarchy-finalize-user →
  omarchy-provision-user` ("Commands unify under the provisioning family"), updating callers but not the
  router table, the usage string or the docs; f4189398 (2026-08-15) rewrote `docs/file-layout.md` *after*
  the rename and still wrote `omarchy finalize user`. GitHub: issue #7113 (2026-08-16, "omarchy --help
  advertises four command groups that contain no commands") open; PRs #7365 and #7796 to drop the stale
  descriptions open.
- **Verdict**: **DEFECT** — the rename was intended; `finalize` in the help, the usage line and three docs
  are stale.
- **Test**: `omarchy provision user --help; echo exit=$?` → `Usage: omarchy provision user`, `exit=0`;
  `omarchy finalize user; echo exit=$?` → `Unknown Omarchy command: omarchy finalize user`, `exit=127`;
  `omarchy --help | grep -c '^  finalize '` → `1` at HEAD (record; expected `0` once #7113 lands).

## 12. `omarchy help` is not a command — question (d)

- **Code**: `bin/omarchy:1073-1090` `main()` — no args → help; `--help|-h` → help; `commands` → listing;
  anything else → dispatcher → `Unknown Omarchy command: omarchy help` / `Run 'omarchy commands --all'…`,
  exit 127.
- **Doc**: the help text itself (`show_main_help`, :518-…) advertises `omarchy <group> --help`; no
  manual, doc or skill mentions `omarchy help`.
- **History**: d2a4cc0c (2026-05-01, Ryan Hughes, PR #5477 "Add omarchy CLI") — `help` was never a verb; no
  commit or issue proposes it.
- **Verdict**: **CODE-INTENDED**.
- **Test**: `omarchy help; echo exit=$?` → `Unknown Omarchy command: omarchy help`, `exit=127`; `omarchy`,
  `omarchy --help`, `omarchy -h` each print `Omarchy command center` and exit 0.

## 13. Tailscale install blocks at `sudo tailscale up`; Ctrl+C kills the setup

- **Code**: `bin/omarchy-install-service-tailscale:11` `sudo tailscale up --accept-routes` (prints a login URL
  and waits for browser auth); :14-22 (`tailscale set --operator`, receive service, bar plugin, web app)
  run only afterwards; no `set -e`. Menu row `default/omarchy/omarchy-menu.jsonc:227` has
  `"disabled":"omarchy-pkg-present tailscale"`, so after an aborted run the row is dimmed.
- **Doc**: `manual/24-commercial-apps-services.md:27`, `manual/35-networking.md:37-41` — "select Install >
  Service > Tailscale"; the login step is not mentioned.
- **History**: `tailscale up` has been the install path since 1484cbb7 (2025-08-09, DHH, "Add Install >
  Service menu with Tailscale added"); e57f3b28 (2026-07-26, Taildrop) and 57ea0b4c (2026-07-29) added the
  follow-up steps after it. Blocking is Tailscale's own login flow.
- **Verdict**: **CODE-INTENDED** for the block (the URL must be visited to finish). Minor **DEFECT**: after
  an abort the Install row is disabled by package presence, so the only way to finish setup is the CLI.
- **Test**: from a terminal `omarchy-install-service-tailscale` → `To authenticate, visit:
  https://login.tailscale.com/a/…` and the command waits; Ctrl+C → `tailscale status; echo rc=$?` →
  `Logged out.`, `rc=1`; `systemctl is-active tailscaled` → `active`; `Install → Service → Tailscale` row
  dim ✓, `Remove → Services → Tailscale` present. Clean up with `omarchy-remove-service-tailscale`.

## 14. Manual: `Super+Ctrl+Alt+W` opens a notification (code: panel)

- **Code**: `default/hypr/bindings/utilities.lua:95` "Toggle weather" → `bin/omarchy-notification-weather:5`
  `omarchy-shell shell toggle omarchy.weather` (summary :3 "Toggle the current weather panel").
- **Doc**: `manual/07-hotkeys.md:211` "Toggle weather as notification"; `manual/05-the-top-bar.md:22`
  (right-click the widget = "Full weather as a notification" — that path is real).
- **History**: 80da45dd (2026-05-17, DHH, "Use the new weather overlay instead") replaced the
  `omarchy-notification-send` call; 8510a819 (2026-05-21, "Toggle weather panel from shortcut") renamed the
  summary. The manual line was written *later*, in 144f4d1e (2026-08-13, "First pass on updates for
  Quattro"), copying "Toggle" from the binding but keeping "as notification".
- **Verdict**: **CODE-INTENDED**; manual needs update.
- **Test**: `Super+Ctrl+Alt+W` → the weather panel layer appears (OCR `SAN FRANCISCO`/`WIND` after
  `omarchy-weather-location --set …`), no toast; second press closes it.

## 15. Manual: clipboard `Return` copies only (code: pastes)

- **Code**: `shell/plugins/clipboard/Clipboard.qml:388-392` — `Return` → `activateIndex` →
  `applySelected` (:215-223) → `omarchy-clipboard-paste-text --shift-insert …`; `Shift+Return` →
  `copySelected` (`--copy-only`, :225-233); `Alt+Return` opens; `Delete`/`Shift+Delete` (:366-367).
- **Doc**: `manual/08-unified-clipboard-history.md:18` "select your entry with return, and then that'll be
  placed on the clipboard ready to paste on `Super + V`."
- **History**: 2713d43f (2026-05-17, DHH, "Replace Walker clipboard with native Quickshell clipboard
  picker") — the very first version ran `copy …; sleep 0.15; wtype -M shift -k Insert -m shift`; 4cd23d95
  (2026-05-21) extracted the helper with `--shift-insert`. The manual sentence dates from the import
  929849c7 (2026-08-13) and describes the pre-May Walker behaviour.
- **Verdict**: **CODE-INTENDED**; manual incomplete (Return pastes *and* copies; Shift+Return is
  copy-only).
- **Test**: with a terminal focused, `Super+Ctrl+V`, pick an older entry, `Return` → the text appears in
  the terminal immediately; repeat with `Shift+Return` → nothing typed, `wl-paste` returns the entry.

## 16. Manual: emoji picker copies (code: inserts)

- **Code**: `shell/plugins/emojis/Emojis.qml:151,224` → `bin/omarchy-menu-emoji-insert:13-20` — transient
  `wl-copy --sensitive --foreground`, `wtype -M shift -k Insert`, then kills the clipboard owner.
- **Doc**: `manual/07-hotkeys.md:338` "emoji picker that'll put the selection on the clipboard".
- **History**: cd2be9da (2026-05-29, DHH, "Insert emojis without persisting clipboard entries") — intent in
  the message: "so Enter inserts immediately … a transient sensitive clipboard entry long enough for
  Shift+Insert, then stops that clipboard owner … clipboard history skips only that event". Manual text
  imported 929849c7 (2026-08-13), stale.
- **Verdict**: **CODE-INTENDED**; manual needs update.
- **Test**: `wl-copy marker`, focus a terminal, `Super+Ctrl+E`, type `smile`, `Return` → the emoji is
  typed into the terminal; `wl-paste` → `marker`; clipboard history (`Super+Ctrl+V`) shows no emoji entry.

## 17. Manual: `Super+Shift+B` undocumented

- **Code**: `default/hypr/bindings/applications.lua:6` `o.bind("SUPER + SHIFT + B", "Browser", { omarchy =
  "browser" })` alongside :3 `SUPER + SHIFT + RETURN` and :7 `SUPER + SHIFT + ALT + B` (private).
- **Doc**: `manual/07-hotkeys.md:102-103` lists `Super + Shift + Return` and `Super + Shift + Alt + B` only.
- **History**: 8e4487ca (2025-09-14, David Boot, PR #1324) first bound `SUPER SHIFT, B` (then private
  browser); 5e63cf9d (2026-02-21, DHH) made it the plain browser; carried into lua by c7b6a7f8
  (2026-05-10) and 2fdc6f05 (2026-06-16). Manual table last touched 1ae83f16 (2026-08-13).
- **Verdict**: **CODE-INTENDED**; manual gap.
- **Test**: `Super+Shift+B` → a `(?i)chromium` window within 45 s (same as `Super+Shift+Return`).

## 18. Manual previews 19 of 22 themes

- **Code**: `themes/` has 22 directories.
- **Doc**: `manual/06-themes.md:3` says "twenty-two"; its preview images cover 19 — missing
  `last-horizon`, `lupine`, `solitude`.
- **History**: `last-horizon` and `solitude` added 2026-05-09 (b2fb2384, 47a53a18, HANCORE via DHH),
  `lupine` 2026-05-24 (1008776d, Bjarne Øverli); the count was fixed in 1ae83f16 (2026-08-13) without adding
  previews; chapter last touched 1fe471dc (2026-08-14).
- **Verdict**: **CODE-INTENDED** (pure doc gap; no behaviour).
- **Test**: `Super+Ctrl+Shift+Space` picker lists 22 themes including `Last Horizon`, `Lupine`, `Solitude`;
  `ls $OMARCHY_PATH/themes | wc -l` → `22`.

## 19. Manual: "any process that needs restarting will be restarted after you quit the editor"

- **Code**: `default/omarchy/omarchy-menu.jsonc:126-128,111,187` — Monitors/Keybindings/Input/Style →
  Hyprland/Config → Hyprland run bare `omarchy-launch-config-editor <file>`; only :188-189 append
  `&& omarchy-restart-hyprsunset` / `&& omarchy-restart-xcompose`. `bin/omarchy-launch-config-editor:14-15`
  only toasts and execs the editor. Hyprland's `misc.disable_autoreload` is left at its default (false) —
  `bin/omarchy-hyprland-reload-guard:61-72` pauses and restores it around transactions — so saving a
  `~/.config/hypr/*.lua` file reloads Hyprland by itself.
- **Doc**: `manual/31-dotfiles.md:5`; `manual/03-coming-from-mac-or-windows.md:43`.
- **History**: 6d7cbf0d (2025-08-05, DHH, "Setup configs menu with auto-restart") added explicit restarts
  only for daemons that do not watch their config (hypridle, hyprsunset, swayosd, walker, waybar,
  XCompose) and none for Hyprland. Those daemons were later replaced by the shell (hot-reloads
  `shell.json`), leaving Hyprsunset and XCompose. 4a665af5 (2026-05-14) preserved the `&&` restarts.
- **Verdict**: **CODE-INTENDED** — and the manual is right *in effect*: Hyprland restarts itself; the
  reviewer's "no `hyprctl reload`" is true but immaterial. No change needed on either side; tests should
  not demand an explicit reload.
- **Test**: `Setup → Monitors`, change `omarchy_monitor_scale` to `1.25`, `:wq` → the desktop rescales
  within 15 s with no further command (restore to `"auto"`); `Setup → Config → Hyprsunset`, `:wq` → a
  `hyprsunset` restart is observable (`pgrep -o hyprsunset` PID changes / nightlight state resets).

## 20. Manual: monitor scale 2 vs shipped `"auto"`

- **Code**: `config/hypr/monitors.lua:7` `local omarchy_monitor_scale = "auto"` (comment: "lets Hyprland
  pick per display"); :21 `local omarchy_gdk_scale = 2`.
- **Doc**: `manual/33-monitors.md:3-4` "assumes you're running on a 2x-capable retina-class display";
  `manual/45-troubleshooting.md:9` "assumes a 2x … which requires setting `GDK_SCALE` to 2". Neither states
  the monitor-scale literal; the "2x" is the GDK default, which is accurate.
- **History**: e39206f2 (2026-05-10, Ryan Hughes, "Simplify montor scaling") introduced `"auto"` with
  `gdk_scale = 2`; 96f356af (2026-05-17) trimmed comments. Manual chapter 1ae83f16 (2026-08-13) is later
  and consistent with GDK=2.
- **Verdict**: **CODE-INTENDED** (the disagreement is a reviewer over-reading; the manual could mention
  `"auto"`).
- **Test**: `grep -E 'omarchy_(monitor|gdk)_scale' ~/.config/hypr/monitors.lua` → `"auto"` and `2`;
  `hyprctl monitors | grep scale` → `1.00` on `Virtual-1` 1280×800; GTK apps oversized is expected.

## 21. `Update → Config` restores groups with `.bak.<epoch>`

- **Code**: `default/omarchy/omarchy-menu.jsonc:355,369-373` five group rows → `bin/omarchy-refresh-hyprland:5-11`
  refreshes seven files; `bin/omarchy-refresh-config:22,31-40` backs up to `<file>.bak.$(date +%s)` and
  deletes the backup when identical.
- **Doc**: `manual/42-common-tweaks.md:3` ("put in a `.bak` file") and :5 ("restore individual configs via
  Update > Config").
- **History**: ff5630c6 (2025-07-30, Andy Davis, PR #402 "Added backup timestamps … to prevent
  clobbering"); fc911e16 (2025-08-03, DHH, group refresh script). Manual text imported 929849c7
  (2026-08-13), imprecise.
- **Verdict**: **CODE-INTENDED**; manual should say "per group" and `.bak.<timestamp>`.
- **Test**: edit `~/.config/hypr/bindings.lua`, run `Update → Config → Hyprland` → floating terminal prints
  `Replaced …/bindings.lua … Saved backup as …bindings.lua.bak.<10 digits>` plus a diff; the other six
  files are rewritten silently with no backup left (identical); per-file CLI is `omarchy refresh config
  hypr/bindings.lua`.

## 22. faillock and LUKS try limits unstated

- **Code**: `etc/security/faillock.conf:7` `deny = 10` ("raising `deny` from 3 to 10 so users get more
  attempts"); `install/config/increase-lockout-limit.sh:3-5` `deny=10 unlock_time=120` in the PAM stack;
  `etc/sudoers.d/omarchy-passwd-tries:1` `passwd_tries=10`. The LUKS limit (3, then emergency shell) is
  the upstream `encrypt` initramfs hook under Plymouth (`etc/mkinitcpio.conf.d/omarchy_hooks.conf:1`),
  not Omarchy configuration.
- **Doc**: `manual/45-troubleshooting.md:37-39` only "typed it wrong too many times … `faillock --reset`".
- **History**: 76c94e26 (2025-08-23, DHH, "Breakup the omnibus config install") carries the deny=10 sed;
  e6e6328d (2026-05-20, Ryan Hughes) added the shipped `faillock.conf`. Deliberate, never documented as a
  number.
- **Verdict**: **CODE-INTENDED** (doc gap).
- **Test**: on the lock screen, 10 wrong passwords → `Authentication failed (10)`; the 11th attempt with the
  correct password is refused; after 120 s (or `sudo faillock --reset --user prime` from a TTY) it unlocks;
  `sudo` shares the lock. LUKS: at most one wrong passphrase per test, never three.

## 23. hype / owe READMEs give install commands that cannot work (other repos)

- **Code**: `omacom/hype` README:12 `sudo pacman -S hype` — no `hype` in `omarchy-pkgs/pkgbuilds`, nor in the
  stable/edge repo databases (`repodb/{stable,edge}.names`); the AUR `hype` is an unrelated Twitch
  client. `omacom/owe` README:29 `omarchy pkg add owe` — `bin/omarchy-pkg-add:8-12` is `pacman -S`, which
  cannot see the AUR where `owe 0.1.0-2` lives.
- **Doc**: the READMEs themselves; `manual/29-other-packages.md:5-7` distinguishes `Install > Package`
  (pacman) from `Install > AUR`.
- **History**: not in this clone; reviewer 60 fetched the READMEs and AUR RPC on 2026-09-18.
- **Verdict**: **DEFECT** (documentation in sibling repos).
- **Test**: `omarchy pkg add owe; echo exit=$?` → `error: target not found: owe`, `exit=1`; `Install → AUR`,
  type `owe` → builds and installs (NET, minutes); `omarchy pkg add hype` → `target not found: hype`.

## 24. elsewhen package path is not scanned by the plugin catalog

- **Code**: `shell/services/PluginRegistry.qml:11` `pluginsDir: home + "/.config/omarchy/plugins"` plus the
  bundled `$OMARCHY_PATH/shell/plugins`; nothing reads `/usr/share/omarchy/plugins`.
  `omarchy-pkgs/pkgbuilds/elsewhen/PKGBUILD:31-35` installs to exactly that path and says so: "scanned by
  the shell … since omarchy PR #12051. An older shell never looks here, so on it this package installs
  cleanly and does nothing"; `sha256sums=('FILL_FROM_RELEASE_ARCHIVE')` (:28).
- **Doc**: `omacom/elsewhen` README:8-10 "Newer Omarchy installs carry Elsewhen as the `elsewhen` package
  … There is nothing to add"; :16 gives `omarchy plugin add https://github.com/omacom/elsewhen.git
  --enable` as the fallback.
- **History**: PR #12051 ("Load packaged plugins from /usr/share/omarchy/plugins and install Atreyu by
  default", spencerbull, 2026-09-16) is **open**, not in d174d4a. The README and PKGBUILD were written
  ahead of it.
- **Verdict**: **UNCLEAR** (doc ahead of code; resolves to CODE-INTENDED once #12051 merges).
- **Test**: `omarchy plugin add https://github.com/omacom/elsewhen.git --enable` → widget appears
  (NET); separately, after `sudo pacman -S elsewhen` (if the package resolves) `omarchy plugin list`
  does not list `omacom.elsewhen` at HEAD — record the result and the `omarchy version`.

## 25. `agent` group description is wrong

- **Code**: `bin/omarchy:29` `GROUP_DESCRIPTIONS[agent]="AI coding agent usage data"`; the group's commands
  are `omarchy agent` ("Launch the default coding agent in a terminal", `bin/omarchy-agent:3`), `agent
  prompt`, `agent crash`, and the `agent usage *` data scripts.
- **Doc**: `omarchy --help` output; `manual/17-ai.md` describes `omarchy agent` as the launcher.
- **History**: bb8d2f2c (2026-08-07, DHH, PR #6603 "Split agent usage into data files and rename the
  plugin to omarchy.agents") wrote the string when the group held only usage scripts; 9502b81f (2026-08-12,
  PR #6757 "Reshape the agent launcher into omarchy agent") and 2cc3510d (2026-08-12, PR #6746 crash
  diagnosis) added the launcher without touching the string.
- **Verdict**: **DEFECT** (stale help string).
- **Test**: `omarchy agent --help` → `Launch the default coding agent in a terminal`; `omarchy --help |
  grep '^  agent '` → currently `AI coding agent usage data` (record; expected to change).

## 26. Menu extension JSONC: one inline `//` silently drops every user entry

- **Code**: `shell/plugins/menu/MenuModel.js:1-5` `stripJsonc` removes only whole-line `//` comments and
  trailing commas; :42-50 `parseMenuJsonc` returns `[]` on any `JSON.parse` error — no log, no toast.
- **Doc**: `docs/menu.md:15-19`: "only whole-line `//` comments are removed, so an inline trailing comment
  breaks the parse. A file that fails to parse contributes no entries — a broken user extension silently
  drops every user entry while the shipped menu keeps working." `manual/31-dotfiles.md:50` shows the
  extension format without warning.
- **History**: 0e135bbb (2026-05-13, Ryan Hughes) / 829c1fa4 (2026-05-25, tests) shaped the parser; the
  limitation was documented deliberately in f4189398 (2026-08-15, DHH, "Bring docs/ up to date").
- **Verdict**: **CODE-INTENDED** (documented limitation). The silence is a usability nit worth a
  maintainer note, not a doc/code conflict.
- **Test**: add `"hello": {"label":"Hello Test","action":"true"}` → row appears on `Super+Space` without a
  shell restart; append ` // x` to that line → `Hello Test` gone, every shipped row present, no toast;
  restore the file → row returns.

## 27. `omarchy refresh config ../…` path escape still live

- **Code**: `bin/omarchy-refresh-config:20-27` interpolates `$1` into both paths and checks only `[[ -e
  $default_config_file ]]`; `../default/bashrc` exists under `$OMARCHY_PATH/config/..` so it copies to
  `~/.config/../default/bashrc` = `~/default/bashrc`.
- **Doc**: `AGENTS.md:123-133` ("Refresh Pattern") records it: "a name containing `..` resolves and copies,
  landing outside `~/.config` rather than being rejected." `test/shell.d/refresh-config-test.sh` has no
  `..` case.
- **History**: the script shape dates from ff5630c6 (2025-07-30); the AGENTS.md caveat was added with the
  docs sweep (2026-08). Documented as a caveat, not as intended behaviour.
- **Verdict**: **DEFECT** (known, unfixed).
- **Test**: `omarchy refresh config ../default/bashrc; echo exit=$?` → intended: `Not a shipped user config`
  and `exit=1`, nothing written; observed HEAD: `exit=0` and `ls -l ~/default/bashrc` exists. Remove
  `~/default` afterwards.

## 28. `Setup → Plugins → Clone` opens `$EDITOR`, not the default editor

- **Code**: `bin/omarchy-menu-plugin:39-41` → `omarchy-plugin-clone <id> --edit`; `bin/omarchy-plugin-clone:166-167`
  `exec $EDITOR "$target_dir"`. On Omarchy `$EDITOR` **is** the default editor: `default/bash/envs:2` and
  `default/uwsm/env.d/10-omarchy:12` export `EDITOR="omarchy-launch-editor --inline"`, which reads
  `~/.local/state/omarchy/defaults/editor` (`bin/omarchy-launch-editor:6-21`).
- **Doc**: `manual/32-shell-plugins.md:69` "Add `--edit` to open the new directory in your `$EDITOR` right
  away, which is what the menu's Setup > Plugins > Clone Plugin does for you."
- **History**: 1bc89105 (2026-08-01, DHH, "Prefix plugin clones with the username…") added `--edit` "to
  open the result in $EDITOR"; the manual line followed on 2026-08-13.
- **Verdict**: **CODE-INTENDED** — documented, and `$EDITOR` resolves to the Omarchy default editor, so
  there is no inconsistency unless the user overrides `EDITOR`.
- **Test**: `Setup → Plugins → Clone Plugin → Clock` → toast `Editing Cloned Plugin`, the floating terminal
  opens `nvim` in `~/.config/omarchy/plugins/prime.clock`; the bar clock keeps working. Remove with
  `omarchy plugin remove prime.clock --yes`.

## 29. Many Install rows have no Remove counterpart

- **Code**: `default/omarchy/omarchy-menu.jsonc:223-242` (Install → Service ×9, Editor ×7, Terminal ×4) vs
  :289-311 (Remove → Services: Dropbox, Tailscale only; no Editor/Terminal submenus). Removers that exist
  as binaries: `omarchy-remove-service-{1password,dropbox,sunshine,tailscale}` — 1Password has a remover
  (d7adaee0, 2026-05-25, added together with its installer) but never got a row.
- **Doc**: the manual promises a Remove path only where one exists (`manual/23-browsers.md:39` browsers,
  `26-gaming.md:7` gaming, `25-web-apps.md:7`, `21-tuis.md:51`, `28-windows-vm.md:49`); `46-faq.md:77-81`
  points to `Remove → Package` / `Preinstalls` for everything else.
- **History**: Remove rows were added per feature (e.g. Tailscale, Dropbox with their installers); no
  commit or doc claims symmetry.
- **Verdict**: **UNCLEAR** (design choice; the general path is `Remove → Package` or the Apps-menu Delete
  key). Sub-item **DEFECT**: `omarchy-remove-service-1password` is unreachable from the menu.
- **Test**: after installing Tailscale, `Remove → Services` shows it; after installing 1Password (medium
  NET), `Remove → Services` does **not** list it, while `omarchy remove service 1password` runs. Record
  which Install rows lack a Remove row.

## 30. Apps-menu `Delete` key leaves `~/.config` behind

- **Code**: `shell/plugins/menu/Menu.qml:1129-1130` `Delete` → `requestDeleteSelected` (:789) → confirm →
  `appLibrary.remove` → `bin/omarchy-remove-launcher-entry:31-52`: web app / TUI removers, else `sudo pacman
  -Rns <owner>` in a floating terminal. `pacman -Rns` never touches `$HOME`.
- **Doc**: the Delete key is not in the manual; `manual/29-other-packages.md:9` says `Remove > Package`
  removes "package, config files, and dependencies" — `-n` = system config files, not `~/.config`.
- **History**: 32b642e0 (2026-05-25, DHH, "Add launcher uninstall confirmation"); ba0d2a76 (2026-06-28) fix.
  No commit or issue asks for dot-dir cleanup.
- **Verdict**: **CODE-INTENDED** (standard package-manager semantics; the manual should document the key).
- **Test**: install `sl` via `Install → Package`, `Super+Alt+Space`, select it, `Delete`, confirm →
  floating `Uninstalling sl…`, `pacman -Q sl` → not found; for a GUI with config (e.g. `kitty` after a
  run) `~/.config/kitty` still exists afterwards — expected, not a failure.

## (a) Is `Super+Escape` the System submenu while `lock-screen` calls it "Omarchy Menu"?

- **Code**: `default/hypr/bindings/utilities.lua:8` `o.bind("SUPER + ESCAPE", "System menu", "omarchy-menu
  toggle system")`; :1 `SUPER + SPACE` = "Omarchy menu" (root); :2 `SUPER + ALT + SPACE` = Apps. Menu node
  `default/omarchy/omarchy-menu.jsonc:33` `"system": {"label":"System","aliases":["power-menu"]}`.
- **Doc**: `manual/07-hotkeys.md:11` "`Super + Escape` — System menu (suspend, restart, etc)";
  `manual/36-system-sleep.md:13,19` "_System_ (or `Super + Esc`)".
- **History**: ceeaa25f (2025-07-10, DHH) bound `SUPER, ESCAPE` to `omarchy-power-menu`; b4a6550b
  (2025-08-04, "Use new omarchy-menu for everything") → `omarchy-menu system`; c7b6a7f8 (2026-05-10) lua;
  4cd6593b (2026-05-23) → `omarchy-menu toggle system`. It has never opened the root menu.
- **Verdict**: **CODE-INTENDED** — `Super+Escape` is and always was the System/power submenu; the
  `lock-screen` definition's "Omarchy Menu" is a misnomer (the driver still lands on the right screen
  because the submenu is a view of the Omarchy menu). Re-word to "System menu".
- **Test**: `Super+Escape` → within 15 s a menu with rows Screensaver, Lock, Suspend, Logout, Reboot,
  Shutdown (Hibernate only when configured); `Backspace` on the empty filter goes up to the root menu.

## (b) Is the missing clock on the lock screen intended?

- **Code**: `shell/plugins/lock/LockView.qml:25,191` — a single field with `Enter Password` / `Checking…` /
  failure text; no time or user-name element; `Service.qml:16` reads `USER` only for PAM.
- **Doc**: `manual/13-toggles-idle-screensaver.md:99` describes lock as blanking the display and resetting
  layout; no clock mentioned anywhere.
- **History**: a clock existed for eight days: d7fc2448 (2025-06-01, DHH, "Add lock screen") shipped
  `hyprlock.conf` with `$TIME` and user labels; 853cbb64 (2025-06-09, DHH, commit titled "Use default
  xournalpp config set to dark mode") removed the `TIME`/label blocks, leaving only the input field. No
  later `hyprlock.conf` revision re-added `$TIME`; 7ea4e1ab (2026-05-19, "Switch hyprlock to QS") built the
  Quickshell lock with the same field-only design.
- **Verdict**: **CODE-INTENDED** — no clock (or user name) since 2025-06-09; the existing `lock-screen`
  proof ("shows the clock", `ctrl.md:89-90`) was never true for any 4.x build.
- **Test**: `Super+Ctrl+L` → screenshot within 5 s shows only the password field (blank after 5 s DPMS;
  mouse-move wakes); assert absence of a clock and user name.

## (c) `omarchy update -y` still asking `Reboot?` → see item 10 (MANUAL-INTENDED, defect; #8986 open).
## (d) `omarchy help` → see item 12 (CODE-INTENDED).
## (e) Phantom `finalize` group → see item 11 (DEFECT: `omarchy-finalize-user` renamed to `omarchy-provision-user` in #6621, 2026-08-09; router table, its usage line, `docs/file-layout.md:39` and `agents/skills/install-scripts.md:10` not updated; #7113 open).

---

## Appendix: two manual disagreements from `01-FACTS.md` [11] (not in the preamble list)

### A1. `Setup → Defaults → Browser` lists every browser (manual: installed only)

- **Code**: `default/omarchy/omarchy-menu.jsonc:152-159` rows have `checked` but no `when`;
  `bin/omarchy-default-browser:7-9` accepts `--install` and installs a missing browser when picked.
- **Doc**: `manual/23-browsers.md:9` "the menu only lists browsers you actually have installed".
- **History**: 0e135bbb (2026-05-13) shipped `"when":"omarchy-cmd-present google-chrome-stable"` guards;
  b724f761 (2026-08-15, DHH, PR #6950 "Install missing apps when choosing defaults") removed them on
  purpose. The manual sentence was written two days earlier (55434792, 2026-08-13).
- **Verdict**: **CODE-INTENDED**; manual stale.
- **Test**: `Setup → Defaults → Browser` shows Chromium ✓, Chrome, Edge, Brave, Brave Origin, Firefox, Zen
  regardless of installation; picking Firefox starts its installer (NET).

### A2. `Super+Shift+G` installs Signal immediately (manual: "offers to install")

- **Code**: `default/hypr/bindings/applications.lua:17` → `bin/omarchy-launch-signal:13-14` execs the
  floating installer when `/usr/bin/signal-desktop` is absent; same shape for Spotify/1Password.
- **Doc**: `manual/22-guis.md:72` "Omarchy will offer to install it for you".
- **History**: 984f3368 (2026-05-25, DHH, "On-demand Signal install"); manual wording 144f4d1e (2026-08-13).
- **Verdict**: **CODE-INTENDED** (loose wording; the sudo prompt is the consent point).
- **Test**: `Super+Shift+G` on the stock disk → floating terminal `Installing Signal…` then the sudo
  prompt; Ctrl+C aborts cleanly with nothing installed.
