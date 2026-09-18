# Omarchy test-definition review — plan and status

> Start with `INDEX.md` for the hand-off: file map, exact status, remaining steps, tooling.

Goal: review every user-reachable behaviour of Omarchy (https://github.com/omacom/omarchy, plus the
org repos that ship inside it) and turn each into a `test_definitions` row (name, description,
instruction, proof) that a driving agent can run against the QEMU guest. Final deliverable:
`test_def/TESTS.md`.

Source under review: `/tmp/omarchy-review/omarchy` @ `d174d4a` (2026-09-18, "Add omarchy up alias"),
1845 files / 421,965 lines. Also `/tmp/omarchy-review/omarchy-iso` @ `7cfb711`.
Org repo list: `/tmp/omarchy-review/org-repos.json`.

Size by tree: bin 459 files/36,949 lines · shell 185/42,452 · test 309/44,569 · manual 95/16,587 ·
themes 249/257,480 (mostly SVG/wallpaper data) · default 187/9,055 · migrations 121/4,286 ·
applications 34/2,858 · docs 9/2,282 · install 85/1,871 · config 42/1,548 · etc 41/574 ·
plans 7/640 · agents 7/435.

## Partition (one reviewer sub-agent per file)

| # | file | scope | status |
|---|------|-------|--------|
| 10 | 10-manual-basics.md | manual 01–14 | FINAL (270 inventory; 69 tests after compliance pass + Print correction: 64 OK / 5 PARTIAL, 3 NET, 1 SLOW) |
| 11 | 11-manual-apps.md | manual 15–29 | FINAL (166 inventory; 82 tests after late compliance pass: 66 OK (20 NET) / 16 PARTIAL (10 NET, 6 SLOW)) — note: synthesis slices snapshot the pre-pass 78 blocks; matrix keys use those names |
| 12 | 12-manual-config.md | manual 30–43 | FINAL (123 inventory; 74 blocks after compliance pass: 58 OK (6 NET, 2 NET+SLOW, 2 SLOW) / 12 PARTIAL / 4 NO appendix; compose + layout-switch now full tests; channel switch + snapshot rollback moved to main list) |
| 13 | 13-manual-rest.md | manual 44–51 | FINAL (69 inventory; 61 tests after compliance pass: 42 OK / 6 PARTIAL / 13 NO, 8 NET, 12 SLOW) |
| 20 | 20-bin-router-cli.md | bin/omarchy router + misc singletons (version, state, debug, done, hook, ascii, transcode, show, upload, file, git, disk, display, monitor, cmd, default, channel, reinstall, installed, upgrade, migrate, sudo, dev, tui, snapshot, reminder, screensaver) + docs/cli-router.md | FINAL (61 items; 55 tests after compliance pass: 49 OK / 6 PARTIAL, 2 NET, 3 SLOW) |
| 21 | 21-bin-theme-branding.md | bin theme-*, branding-*, font-*, plymouth-*, refresh-*, apply-*; docs/theming.md; themes/; default/themed | FINAL (64 scripts; 62 tests after compliance pass: 58 OK (3 NET, 4 SLOW) / 4 PARTIAL) |
| 22 | 22-bin-launch-menu-webapp.md | bin launch-*, menu-*, omarchy-menu, webapp-*, games-*, chromium-*, openclaw, agent-*, omarchy-agent; default/omarchy/omarchy-menu.jsonc; docs/menu.md; launcher.hides | FINAL (340 menu entries; 73 tests after compliance pass: 61 OK / 12 PARTIAL, 10 NET, 1 SLOW) |
| 23 | 23-bin-install-remove-pkg.md | bin install-*, remove-*, pkg-*, mise, voxtype-*, tailscale-*, windows-*, hermes, reinstall | FINAL (97 scripts; 56 tests after compliance pass: 39 OK / 8 PARTIAL / 9 NO, 39 NET, 14 SLOW) |
| 24 | 24-bin-system-power-update.md | bin update-*, omarchy-update, system-*, power, hibernation-*, powerprofiles-*, battery-*, snapshot, drive-*, crash-*, provision-*, setup-*; docs/update-process.md | FINAL (67 scripts; 48 tests after compliance pass: 38 OK / 9 PARTIAL / 1 NO, 8 NET, 8 SLOW) |
| 25 | 25-bin-hyprland-toggle-desktop.md | bin hyprland-*, toggle-*, omarchy-toggle, restart-*, shell, bar, osd, notification-*, capture-*, clipboard-*, brightness-*, audio-*, network-*, dns, bluetooth-*, weather-*, hw-*, plugin-* | FINAL (137 scripts; 69 tests after late compliance pass: 55 OK (4 NET) / 11 PARTIAL / 3 NO) — synthesis slices snapshot the pre-pass 73 blocks; matrix keys use those names |
| 30 | 30-shell-bar-osd-notifications.md | shell/plugins/{bar,osd,notifications,reminders}; docs/omarchy-shell.md; docs/notifications.md | FINAL (78 inventory; 38 tests after compliance pass: 32 OK / 6 PARTIAL, 2 NET, 1 SLOW) |
| 31 | 31-shell-panels-menu.md | shell/plugins/{panels,menu,polkit,clipboard,emojis,image-picker,agents,dev-gallery} | FINAL (19 panels + 18 controls; 56 tests after compliance pass: 50 OK / 6 PARTIAL, 3 NET, 1 SLOW) |
| 32 | 32-shell-lock-background-services.md | shell/plugins/{lock,background,services}; shell/services; shell/Ui; shell/Commons; shell.qml | FINAL (65 inventory; 41 tests after compliance pass: 36 OK (1 SLOW) / 5 PARTIAL (1 NET)) |
| 40 | 40-hypr-config-bindings.md | config/hypr/*; default/hypr/** (every binding, window rule, toggle, workspace layout) | FINAL (240 bindings kept; 60 tests after compliance pass + Print/CapsLock/alt_r correction + merges: 50 OK / 8 PARTIAL / 2 NO, 5 NET, 1 SLOW) |
| 41 | 41-default-system.md | default/** (non-hypr); applications/; etc/**; config/** (non-hypr) | FINAL (140 items; 68 tests after compliance pass: 64 OK / 3 PARTIAL / 1 NO, 9 NET, 7 SLOW) |
| 42 | 42-install-firstrun-provisioning.md | install/**; omarchy-iso repo; manual 51; docs/file-layout.md | done (2166 lines, 163 items, 51 tests: 31 OK / 3 PARTIAL / 17 NO (12 runnable from ISO)); compliance pass lost to the billing outage — synthesizers normalise its blocks |
| 43 | 43-migrations-update.md | migrations/**; omarchy-update*; omarchy-migrate | FINAL (121 migrations; 27 tests after compliance pass: 25 OK (15 NET, 12 SLOW) / 2 PARTIAL; post-update-* reuse the updated disk) |
| 50 | 50-existing-acceptance-tests.md | test/acceptance*, agents/skills/acceptance-tests.md, docs/testing.md | FINAL (165 assertions; 33 tests after compliance pass: 31 OK / 2 PARTIAL, 1 NET) |
| 51 | 51-existing-shell-tests-a-l.md | test/shell.d/[a-l]* | FINAL (118 files / 574 behaviours; 71 tests after compliance pass: 66 OK / 5 PARTIAL (5 NET, 1 SLOW) + 8 NO appendix; every drivable file in a covers: line) |
| 52 | 52-existing-shell-tests-m-z.md | test/shell.d/[m-z]* | FINAL (127 files / 463 behaviours; 63 tests after compliance pass: 55 OK (6 NET, 5 SLOW) / 8 PARTIAL; dedupe-with: on 4) |
| 60 | 60-org-apps.md | omacom org repos shipped in Omarchy (omasnap, omareel, omacalc, omawrite, omacut, hype, monologue, owe, herdr, aether, ttfx, elsewhen, plugins, registries, try-omarchy, omarchy-pkgs, omarchy-mirror) | FINAL (60 repos classified; 37 tests after compliance pass: 29 OK / 4 PARTIAL / 4 NO, 19 NET, 1 SLOW) |
| 61 | 61-docs-plans-agents.md | docs/*, plans/*, agents/skills/*, default/agents/skills/** | FINAL (140 invariants; 41 tests after compliance pass: 35 OK (1 NET) / 4 PARTIAL / 2 NO) |

## Synthesis

- `90-coverage-matrix.md` — every inventory line mapped to a test name (or a gap).
- `TESTS.md` — the final list, deduplicated, grouped, each in table form, with an appendix of
  not-runnable-here tests.

## Reviewer sub-agents (ids, for resume)

| file | agent id |
|------|----------|
| 10 | eeae6d69-9f10-4dac-bcc4-d69e0838e9f0 |
| 11 | 63df735b-99e7-4d8d-abd3-aa2837bb9116 |
| 12 | ff1f563c-a821-448c-b3e4-267c34416448 |
| 13 | d4138227-2e92-4aef-9538-b18eebdd234e |
| 20 | 0c00d672-e86a-4d3c-a1cb-50e91a083946 |
| 21 | f89b860e-bde3-4a72-8fbf-ad78c90b6eab |
| 22 | 77a1c7b9-ff16-479d-9b28-3cdece8f5157 |
| 23 | f9b5911c-65bd-4654-8222-d6463eeb14a6 |
| 24 | 5c3a4dec-3ed7-45cf-a23b-9a20e07883e3 |
| 25 | a589a11c-4f02-4170-b778-005d67442d20 |
| 30 | 7922e465-fedb-4253-93d9-5badc7e8c5dc |
| 31 | 48df45c6-ef76-489a-94b3-87ddbac54154 |
| 32 | 80e0473d-bd54-432e-b9b1-c5d78d148a78 |
| 40 | 17112638-a998-45ff-81d6-5320422a4933 |
| 41 | a5fb1a9d-7b07-4b64-9dcd-2e4a98d4fbdb |
| 42 | 38490659-207d-4546-ae3b-69ccd53ee2cc |
| 43 | 4e372fe8-bbc9-4543-a989-4204c7365a42 |
| 50 | 6c3b9b51-f7c4-4bfc-b9c4-332bb807a83f |
| 51 | 2804b218-88ac-4ec5-9eda-44be23466c7b |
| 52 | 0e5b9ae0-4f15-464f-a93c-931b3ee62e48 |
| 60 | 9f26d2d3-dee5-4197-b102-1118085b38be |
| 61 | 2f81abb9-bb1e-4f2e-9f58-4f42d517f209 |

## Own reading (orchestrator)

- `default/omarchy/omarchy-menu.jsonc` (380 lines) — read in full. Root: Apps, Learn, Trigger, Style,
  Setup, Install, Remove, Update, About, System. Guards (`when`) hide laptop/hw entries on the VM;
  `disabled` marks installed software with ✓. Note `Super+Space` = Omarchy menu root,
  `Super+Alt+Space` = Apps, `Super+Escape` = System submenu, `Super+Ctrl+C` = Capture,
  `Super+Ctrl+O` = Toggle, `Super+Ctrl+H` = Hardware, `Super+Ctrl+Space` = Background,
  `Super+Shift+Ctrl+Space` = Theme, `Super+Ctrl+S` = Share, `Super+Ctrl+R` = Reminder set.
- `default/hypr/bindings/*.lua` — read in full (applications, clipboard, media, tiling, utilities,
  voxtype). Hyprland config is Lua (`o.bind`, `hl.dsp.*`). Workspaces via `code:10..19`
  (the number row) so `<M-1>`..`<M-0>` are right for the driver. `Super+L` is workspace layout
  toggle, NOT lock; lock is `Super+Ctrl+L`. `Super+K` keybindings viewer. `Super+Ctrl+Q` omacalc.
  Bar panels via `Super+Ctrl+1..9`. Universal copy/paste `Super+C/V/X`. Clipboard manager `Super+Ctrl+V`.
- `manual/49-omarchy-on.md` — nothing QEMU-specific; VirtualBox/VMware/Parallels only via discussions.

## Watch items

- 13:40 — 10, 24, 31 were mid-rewrite during compliance passes; all three re-landed intact (69, 48, 56 tests). Resolved.
  mid-rewrite with the Proposed tests section removed. **Verify on completion that the tests were
  re-added**; if a pass ends with the file truncated, resume the agent to restore the section.

## Synthesis (15:36 →)

12 domain synthesizers dispatched on `/tmp/omarchy-review/domains/*.md` slices (1,235 blocks) per
`/tmp/omarchy-review/SYNTH.md`; outputs `test_def/9N-final-*.md` / `10N-final-*.md` with
`merged-from:` accounting. Research agent writing `03-INTENDED-BEHAVIOUR.md` (git history verdicts
for every doc/code disagreement). 11/25/42 compliance passes skipped (billing outage); synthesizers
normalise those blocks. Then: `90-coverage-matrix.md` (script from merged-from) and `TESTS.md`.

| slice | blocks | agent |
|---|---|---|
| A1-lock-idle-session | 128 | DONE 5026551d: 31 tests (80 blocks) / 1 not-runnable / 47 moved (mis-slices: lock∈clock/capslock, login∈tailscale) / 0 dropped |
| A2-power-boot-snapshots | 65 | DONE 2b62728d: 26 tests (53 blocks; 13 SLOW) / 0 not-runnable / 12 moved / 0 dropped; LUKS proofs via `cryptsetup --test-passphrase` cut reboots; factory reset kept VM-OK SLOW |
| B-menu-launch | 121 | DONE a198b63b: 32 tests (99 blocks) / 0 not-runnable / 22 moved / 0 dropped; timezone fix-up + verdicts 7,17,19,25,26,30,(a),(b),A1 applied |
| C-hyprland-windows | 134 | DONE 120ffafe: 46 tests (108 blocks) / 1 not-runnable / 25 moved / 0 dropped; all 103 tiling.lua binds covered; verdicts 17,19,20,21,(a) applied |
| D-bar-panels-notify | 146 | DONE cf326b9f: 45 tests (129 blocks) / 0 not-runnable / 17 moved / 0 dropped; verdicts 7,14,15,16 applied |
| E-theme-style | 105 | DONE d25aa9da: 51 tests (98 blocks) / 1 not-runnable / 6 moved / 0 dropped; verdicts #8 #27 #21 #18 #23 applied |
| F1-install-remove-machinery | 128 | DONE 09f35454: 43 tests (100 blocks) / 6 not-runnable (8 blocks) / 20 moved / 0 dropped; verdicts #1 #5 #6 #13 applied; file verified single-writer-consistent (4 sections, no dup names) |
| F2-apps-in-use | 55 | DONE 7be27ee3: 30 tests (42 blocks) / 3 not-runnable / 10 moved / 0 dropped |
| G1-update-migrations-channels | 102 | DONE 130c8be0: 36 tests (88 blocks) / 1 not-runnable / 12 moved / 0 dropped; verdict #10 (`-y` never prompts) asserted, #9 recorded |
| G2-cli-router-dev-debug | 74 | DONE 1d82d99a: 24 tests (44 blocks) / 0 not-runnable / 30 moved (each names its sibling test in the target) / 0 dropped; fixed reviewer 20's destructive `rm -r post-update.d` cleanup |
| H-system-shell-security | 147 | DONE 7ffe49cb: 62 tests (128 blocks) / 2 not-runnable / 17 moved / 0 dropped; verdict #2 (sshd bad key) asserted intended; routing pass running |
| I-iso-appendix | 30 | DONE 43179c42: 0 tests / 16 not-runnable (24 blocks) / 6 moved (theme×4→E, webapp×2→F1) / 0 dropped |
| research: intended behaviour | — | f8026abc-7b18-4bb0-ae9c-a1c3667a390a |

## Routing pass (16:25 →)

224 moved blocks parsed from the 12 final files into `/tmp/omarchy-review/routing/<T>.md`
(A1 2 · A2 4 · B 17 · C 15 · D 52 · E 18 · F1 31 · F2 14 · G1 11 · G2 9 · H 47 · I 4). Each target
synthesizer resumed with `/tmp/omarchy-review/ROUTE.md`: fold incoming blocks into existing tests or
add tests, extend `merged-from`, apply verdicts if not yet applied (A1, A2, F2, G2, I). A1 also writes
the `lock-screen` (v2) re-versioned wording. H's resume waits for its first-pass report. After all
report: `python3 tools/assemble.py -v` must show moved-only 0 → then `-w`.

## Sweep after routing (orchestrator)

- Rerouted stragglers: `12:autostart-lua-launch-on-start` (A1 → C), `31:dev-gallery-text-and-number-fields`
  (A2 → D). Fold by hand or a tiny resume.
- `12:autostart-lua-launch-on-start` (A1 → C) folds into C's new `autostart-lua-user-entry-runs-on-login`.
- F1 rerouted: `11:lazydocker-polkit-prompt` → B (`launch-docker-tui-polkit-gate`);
  `42:firstrun-force-rerun-toasts`, `42:firstrun-offline-shows-wifi-toast` → H (provisioning tests).
- G2/D ping-pong: BOTH G2 and D built a test named `agent-invitation-toast-once` (G2 from
  `22:agent-invitation-notification`, D from `51:agent-invitation-hook-once`). Keep D's (agents widget
  domain), fold `22:…` into its merged-from, delete G2's block and D's stale Moved line.
- A2 → D: `31:dev-gallery-text-and-number-fields` folds into D's new `dev-gallery-controls-walk-and-dropdowns`.
- D → H: `41:oomd-app-slice-candidacy` rerouted (twin `24:oomd-kills-runaway-app-not-session` already in H).
- B/H ping-pong: B built `nightlight-toggle-hotkey-menu-and-status` and
  `shell-restart-from-menu-and-supervisor-relaunch` from H's blocks; B's own
  `10:nightlight-toggle-hotkey-status`, `22:launch-shell-supervisor-recovers`,
  `25:restart-shell-from-menu` went to H. If H's routing pass created duplicate tests for them,
  remove H's and fold the three refs into B's tests.

## Synthesis fix-ups (apply when building TESTS.md)

- 22's `Update → Timezone` test assumed a silent sudo failure; it must expect **success** (NOPASSWD
  rule `omarchy-tzupdate` exists since 4.0.2). Verified by orchestrator against the tree and tags.
- 31's DNS-pill test mentions a possible polkit dialog on 4.0.2; drop that caveat (`omarchy-dns`
  sudoers exists since 4.0.2).
- 32 notes the existing `lock-screen` proof mentions a clock that is not on the lock screen; propose
  a re-versioned wording in TESTS.md.

## Heartbeat 13:44

Final 7 (21,22,23,24,31,32,50 = 369 tests). Compliance in flight: 10, 12, 13, 40. First pass written
awaiting report: 20 (69), 30 (57), 51 (177 → consolidate), 60 (40), 61 (51). No file yet: 11, 25, 41,
42, 43, 52 (largest scopes; not stuck). Re-armed 20 min.

## Log

- 2026-09-18 16:50 — routing + sweep done; TESTS.md (468 + 37) and 90-coverage-matrix.md written; accounting exact.

- 2026-09-18 13:05 — cloned repos, wrote 00-FORMAT.md, partitioned.
- 2026-09-18 13:15 — 22 reviewers launched in three batches; orchestrator read menu + bindings.
- 2026-09-18 13:25 — user clarifications folded into 00-FORMAT.md: rule zero (UI or in-guest
  terminal only, everything via QEMU), the `./client` verb table (every step must map to
  send-keys / mouse / get-image / get-serial), and the `lock-screen` calibration (one user story per
  test, quirks named, round trip asserted, concrete proof). Reviewers launched before this read the
  older spec (same constraints, less explicit): **on completion, resume each with a compliance pass**
  against the updated 00-FORMAT.md before synthesis.
