# G2 — CLI router, dev tools and debug — final tests

This domain covers the `omarchy` command itself as a user experiences it from a terminal: discovering
commands (bare `omarchy`, `commands`, `--check`, group help, the phantom `finalize` group), help that
never executes, typo guidance and aliases (`omarchy up`), hidden plumbing that routes but is not
listed, the shipped agent skill's command contract, the `state`/`done`/`hook` primitives and their
traversal guards, `omarchy debug` and `omarchy upload`, every `omarchy dev` tool (link/unlink with the
safety rules, status, benchmarks, pkg-test, ui-preview, font, theme-preview, install ydoo),
`transcode`/`transcode ascii`, `disk speedtest`, and the `reminder`, `menu` and `agent` command lines
that landed here. 74 source blocks → 24 tests built from 44 blocks; 30 blocks are moved to the domain
that owns their story (theme/background/font/refresh CLI → E, install and remove machinery → F1,
networking/docker/supply-chain/plugin guards → H, bar layout and battery/agent toasts → D, capture → C,
session health → A1, org apps → F2); nothing dropped, nothing unrunnable. Notable merges: four
`omarchy debug` blocks → `debug-report-print-view-save-no-upload`; four `omarchy menu` blocks →
`menu-cli-summon-toggle-close-and-rejects`; four hook blocks (install/run, theme-set sample, theme+font
hooks, skill hook) → `hooks-install-run-theme-set-and-reject`; three discovery blocks, three
help-safety blocks and three state/done blocks → one test each.

Conventions used by every test below: the terminal is opened with `Super+Enter` (foot); exit codes are
invisible on screen, so negative steps append `; echo "exit=$?"`; anything longer than a screen goes
through `… | sudo tee /dev/ttyS0 >/dev/null` (password `prime`) and is read with `./client get-serial`.
The disk is 4.0.2 while the source is HEAD, so each router test records `omarchy version` first and
treats missing HEAD-only features (`omarchy up`, `commands --json`, `--help --json`) as skew to note,
not as failures. `03-INTENDED-BEHAVIOUR.md` appeared after the first pass; the routing pass applied its
verdicts: #11 (phantom `finalize` group, DEFECT, issue #7113 — proofs assert `omarchy provision user
--help` works and `finalize` is absent from `--help`, recording HEAD's listing and exit 127 as the
defect), #25 (`agent` group description, DEFECT — intended text describes launching an agent; the stale
"usage data" string is the defect), #12 (`omarchy help` is not a command, CODE-INTENDED — assert the
router). #27 (`refresh config ../…`) lives in E with `21:refresh-config-cli-guards`.

Routing pass: 9 incoming blocks → 2 folded into existing tests (`transcode-ascii-cli-and-rejects`,
`agent-skill-command-contract`) and 7 into 6 new tests (`ascii-wordmark-render-skip-and-rejects` from
two `omarchy ascii` blocks — a different command from `transcode ascii`; `dev-add-migration-in-temp-repo`;
`agent-usage-update-without-login`; `agent-invitation-toast-once`, whose sibling
`51:agent-invitation-hook-once` was moved to D in the first pass and should be folded back here by the
orchestrator; `cli-tab-completion-discoverability`; `plans-unshipped-commands-absent`). Totals after the
pass: 83 blocks → 30 tests.

## Tests

### cli-discover-commands-and-groups   [VM-OK]
description: A user discovers what Omarchy can do from the terminal: the bare `omarchy` banner and alphabetical group table, `omarchy commands` with hidden plumbing kept out unless `--all`, the catalogue's self-check and JSON, a hidden group that still routes, and two help-text defects pinned to their intended state — the renamed `omarchy provision user` must work while the stale `finalize` group must not be advertised (issue #7113), and the `agent` group line must describe launching an agent.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter, press Super+F so it fills the screen, type `omarchy version` and press Enter; record the version (e.g. `4.0.2-1`).
  * Type `omarchy | head -n 20`; the first line must be `Omarchy command center`, followed by `Usage:` and `Common commands:` (`omarchy update`, `omarchy theme list`, `omarchy theme set <name>`, `omarchy font list`, `omarchy screenshot`, `omarchy debug`…), with `Groups:` and `Discovery:` blocks further down.
  * Type `omarchy | sed -n '/^Groups:/,/^Discovery:/p' | sudo tee /dev/ttyS0 >/dev/null` (password `prime`) and read it with get-serial.
  ** The group table is alphabetical (`agent` first, `windows` last), two columns, no counts; `theme`, `update`, `crash` and `agent` must appear; `show`, `upgrade`, `apply`, `provision`, `state`, `done`, `upload` and `git` must NOT.
  ** Intended: no group with zero commands is advertised, so `finalize` (and `branch`, `config`, `wifi`) must be absent. At HEAD they are still listed (`omarchy --help | grep -c '^  finalize '` → `1`; expected `0` once issue #7113 lands) — record the count as the defect, do not treat it as a pass.
  ** Intended: the `agent` row describes launching an agent, matching `omarchy agent --help` → `Launch the default coding agent in a terminal`. At HEAD `omarchy --help | grep '^  agent '` still reads `AI coding agent usage data` — record the stale string as the defect.
  * Type `omarchy capture`; expected `Capture commands — Screenshots and screen recording:` with rows qr, screenrecording, screenshot, text, webcam resize. Then `omarchy apply`; expected the header `Apply commands:` followed by `No documented commands found. Try: omarchy commands --all` — a hidden group still routes.
  * Renamed route (issue #7113): type `omarchy provision user --help; echo "exit=$?"`; expected `Usage: omarchy provision user`, `exit=0` — the binary `omarchy-provision-user` routes under its real name (hidden; visible in `omarchy commands --all`). Then `omarchy finalize; echo "exit=$?"` and `omarchy finalize user; echo "exit=$?"`.
  ** Expected: `Unknown Omarchy command: omarchy finalize` (and `… omarchy finalize user`) with `exit=127` both times — correct, since the route was renamed; the defect is only that `finalize` is still advertised in the Groups table (and in `docs/file-layout.md`, `agents/skills/install-scripts.md` and the binary's own usage line). Quote the exact text. `commands --check` does not catch this.
  * Type `omarchy commands | head -n 3; omarchy commands | grep -cE 'omarchy (state|done|upload log|version branch)'; omarchy commands --all | grep -cE 'omarchy (state|done|upload log|version branch)'`; expected `Omarchy commands:` with indented `omarchy … <summary>` rows, then `0`, then `4` — hidden commands only show under `--all`. Then `omarchy commands | grep -c provision` → `0` and `omarchy commands --all | grep -c provision` → 3 or more.
  * Type `omarchy commands --check; echo "exit=$?"`; expected one line `Command metadata check passed (N commands)` with N ≥ 200 and `exit=0`. Then `omarchy commands --json | jq -r '.ok, (.commands|length)'` → `true` and a number ≥ 200.
  ** `--json` is HEAD-only: plain help or an unknown-option message on 4.0.2 is version skew — record it with the version, do not fail the test.
  * Unhappy path: type `omarchy commands --bogus; echo "exit=$?"`; expected `Unknown option for omarchy commands: --bogus`, the `omarchy commands` usage, nothing listed, `exit=2`.
  * Press Super+F to un-fullscreen and Super+W to close the terminal; the desktop is as it started.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The full `omarchy` output is ~90 lines (a ~70-row Groups table); fullscreen may fit it, otherwise only the head and the serial dump are readable — do not try to screenshot it whole.
  * ./client-with-image allows you to get an image back of what you did, so can be useful for speeding things up
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the version, the `Omarchy command center` header with Common commands, the `Capture commands —` header, and the `Apply commands:` / `No documented commands found` pair
  ** Serial dump of the alphabetical Groups block without `show`/`upgrade`/`apply`/`provision`; the `finalize` grep count and the `agent` row text quoted verbatim — a pass on these two rows means `0` and a launch-an-agent description; `1` and `AI coding agent usage data` are the known HEAD defects (#7113, stale string) to capture, not failures of the rest of the test
  ** Screenshot of `omarchy provision user --help` with `exit=0`, the `omarchy finalize` results with `exit=127` quoted verbatim, the grep counts (`0`/`4` and `0`/≥3), the `--check` pass line, the jq values (or the recorded skew) and the `--bogus` refusal with `exit=2`
  * If unsuccessful
  ** the terminal output of the invocation that errored, hung, or listed a hidden command by default; `omarchy provision user --help` failing to route; serial dump of the full `omarchy commands --check` output (it names the offending binary)
covers: bin/omarchy:29-97,414-424,509-547,549-784,1073-1091; bin/omarchy GROUP_DESCRIPTIONS (:29 agent, :45 finalize); bin/omarchy-provision-user:4,10; bin/omarchy-agent:3; bin/omarchy-version; docs/cli-router.md "Groups and the top-level listing", "Introspection"; test/cli:54-109; AGENTS.md §Command Naming; docs/file-layout.md:39-40; agents/skills/install-scripts.md:10; manual/14:7-58; 03-INTENDED-BEHAVIOUR #11, #25 (issue #7113)
merged-from: 20:cli-discover-commands; 61:cli-command-discovery; 10:omarchy-cli-help-groups-check-unknown

### cli-help-never-executes   [VM-OK]
description: Asking any Omarchy command for help never runs it: bare groups, `--help` anywhere in the arguments (even after `update`), and bare routes with required arguments print synthesized help, spaced and hyphenated spellings reach the same binary, and only a real bad argument reaches the binary's own refusal.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter; screenshot the bar and terminal colours for later comparison. Type `omarchy dev`; expected `Dev commands — Omarchy development tools:` with 11 rows (`omarchy dev link <path-to-checkout> [--no-reboot]`, `omarchy dev status`, …) and nothing executed. Then `omarchy theme --help | head -3` → `Theme commands — Theme management:`.
  * Type `omarchy update --help`, then `omarchy update aur --help`, then `omarchy update bogus --help`; each prints help with `Usage:` and `Binary:` / `omarchy-update`. Wait 5 s and screenshot again — no sudo prompt, no `Ready to update?` box, no update banner or package list.
  ** If a sudo prompt or progress bar appears, press Ctrl+C immediately and report it (an `update --help` that started an update was a real bug).
  * Type `omarchy version --help`; expected `Usage:` / `omarchy version`, `Binary:` / `omarchy-version`, and `Related commands:` listing `version channel` and `version pkgs` but NOT the hidden `version branch`. Then `omarchy show --help`; expected the header exactly `Show commands:` (no em-dash — the group has no listing entry) with `omarchy show done [exit-code]` and `omarchy show logo`.
  * Type `omarchy snapshot; echo "exit=$?"`; expected `Usage:` / `omarchy snapshot <create|restore>` and `exit=0`, no sudo prompt. Then `omarchy reminder; echo "exit=$?"` — its usage and `exit=0`, no toast. Then `omarchy theme set` with no name — the same kind of usage instead of an interactive picker, colours unchanged; `omarchy theme set --help | grep -i binary` → a `Binary:` line with `omarchy-theme-set`.
  * Type `omarchy capture screenshot --help`; expected Usage, "Take a screenshot", Arguments, Examples, `Aliases` / `omarchy screenshot`, `Binary` / `omarchy-capture-screenshot`. Then `omarchy dev theme preview --help | grep -A1 Binary` and `omarchy dev theme-preview --help | grep -A1 Binary`; both print `omarchy-dev-theme-preview`.
  * Type `omarchy menu -- --help` → the menu's own text `Usage: omarchy menu [verb] [route]` (the `--` handed the flag to the binary). Then `omarchy theme set --help --json | jq -r '.ok, .command.binary'` → `true` and `omarchy-theme-set`.
  ** `--help --json` is HEAD-only: on 4.0.2 this may print plain help instead — record it with `omarchy version`.
  * Unhappy path — a real argument does reach the binary: type `omarchy theme set nosuchtheme; echo "exit=$?"` → `Theme 'nosuchtheme' does not exist`, `exit=1`; then `omarchy theme set ../etc; echo "exit=$?"` → `Invalid theme name: ../etc`, `exit=1`. Colours unchanged.
  * Close the terminal with Super+W; the desktop colours are unchanged from the first screenshot.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Help output is short; one screenshot per command is enough.
  * If a gum confirmation box ever appears, press Escape immediately and report it as the failure.
  * Compare the first and last screenshots to prove the theme never changed.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the help blocks with the quoted headers (`Dev commands —`, `Theme commands —`, `Show commands:`), the two 5-seconds-apart screenshots after the `update … --help` variants showing an idle prompt, the two identical `Binary:` lines, the `Aliases` line, the menu usage and the jq output (or the recorded skew)
  ** Screenshot of the two theme refusals with `exit=1`; first and last screenshots with identical bar/terminal colours
  * If unsuccessful
  ** the sudo prompt / update banner / snapshot output that proves a command ran, an `Unknown Omarchy command` for a valid spelling, or a changed theme; `cat /tmp/omarchy-update.log | head` if an update began
covers: bin/omarchy:126-149,361-372,389-412,736-738,799-909,949-1047; bin/omarchy-theme-set:8,283-290; docs/cli-router.md "Dispatch" (help interception, required-args guard, `--`); docs/testing.md:16-17; test/cli:54-56,111-131,185-195,236-239,664-715
merged-from: 20:cli-help-is-safe; 50:cli-help-never-executes; 61:cli-help-never-executes

### cli-unknown-command-typos-and-aliases   [VM-OK]
description: Typos and half-typed routes fail fast: unknown routes exit 127 with a "Did you mean" hint and a pointer to `omarchy commands --all`, partial routes list what could follow, `omarchy help` is by design not a command (only `--help`/`-h` are — code-intended; no doc ever promised `help`), a root binary swallows extra words, and alias and filename routes reach their binary.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy help; echo "exit=$?"`.
  ** Expected: `Unknown Omarchy command: omarchy help`, `Run 'omarchy commands --all' to discover available commands.`, `exit=127`. Then `omarchy --help | head -1; omarchy -h | head -1; omarchy | head -1` → `Omarchy command center` three times — those are the help spellings. A command-center help for `omarchy help` would be a behaviour change to report, not the intended state.
  * Type `omarchy ver; echo "exit=$?"`; expected the Unknown line, `Did you mean: omarchy version ?`, the Run line, `exit=127`. Then `omarchy themx list; echo "exit=$?"` → `Unknown Omarchy command: omarchy themx list`, the Run line, `exit=127`.
  ** A `Did you mean: omarchy … ?` line appears only when a known route starts with the typed word; report whether one appeared for `themx`.
  * Type `omarchy bogus-nothing; echo "exit=$?"`; expected the Unknown and Run lines, no `Did you mean`, `exit=127`.
  * Type `omarchy dev benchmark; echo "exit=$?"`; expected a prefix listing `dev benchmark commands:` with `omarchy dev benchmark cli …` and `… theme switcher …`, `exit=0`, no benchmark run. Then `omarchy hw asus` → a listing headed `hw asus commands:` with rows such as `omarchy hw asus rog`; then `omarchy hw asus rog; echo "exit=$?"` → no output and `exit=1` (a quiet hardware predicate; this is not an ASUS machine).
  * Type `omarchy dev bench; echo "exit=$?"`; expected `Unknown Omarchy command: omarchy dev bench`, `Did you mean: omarchy dev ?`, `exit=127`.
  * Quirk: type `omarchy version chan; echo "exit=$?"`; `version` is a root binary, so the version string prints with `exit=0` — no error. Record it.
  * Aliases and filename routes: type `omarchy screenshot --help` → help naming binary `omarchy-capture-screenshot`; then `omarchy share --help` and `omarchy menu share --help` → both name binary `omarchy-menu-share` (canonical and filename route).
  * Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * All messages go to stderr but appear in the same terminal; nothing scrolls. The `exit=` echo is the proof of the exit code.
  * ./client-with-image allows you to get an image back of what you did, so can be useful for speeding things up
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of each result with its `exit=` line; `omarchy help` refused with `exit=127` beside the three `Omarchy command center` headers; the Unknown line with the discovery pointer and `exit=127` for `ver`, `themx list` and `bogus-nothing`
  ** Screenshot of the `dev benchmark` and `hw asus` prefix listings with `exit=0`, the quiet predicate's `exit=1`, the `version chan` quirk, and the alias and both share routes naming one binary each
  * If unsuccessful
  ** an invocation that hangs, runs something, or exits 0 where 127 is expected (other than the recorded quirks); `omarchy commands --all | grep share`
covers: bin/omarchy:824-841,934-947,1060-1070,1073-1090; docs/cli-router.md §Dispatch ("did you mean", prefix listing), §How a binary becomes routes (share, aliases); 03-INTENDED-BEHAVIOUR #12
merged-from: 20:cli-unknown-command-and-typos; 61:cli-mistyped-command-guidance

### cli-alias-omarchy-up   [VM-OK]
description: `omarchy up` is a new alias for `omarchy update`: its help resolves to the update binary and the alias table lists it, without starting an update; on a 4.0.2 disk the alias may not exist yet and that is recorded as version skew.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy version`; note the version.
  * Type `omarchy up --help; echo "exit=$?"`.
  ** Expected at HEAD: `Usage:` / `omarchy update [-y]`, an `Aliases:` block with `omarchy up`, `Binary:` / `omarchy-update`, `exit=0`.
  ** On a disk predating the alias: `Unknown Omarchy command: omarchy up`, a `Did you mean: omarchy update ?` (or `upgrade`/`upload`), `exit=127` — record verbatim with the version; this is skew, not a failure.
  * Wait 5 s and screenshot: no sudo prompt, no update banner.
  * Type `omarchy commands | sed -n '/^Aliases:/,$p'`; at HEAD the table contains `omarchy up  omarchy update` beside `omarchy screenshot`, `omarchy reboot`, `omarchy shutdown`, `omarchy logout`, `omarchy background`, `omarchy screenrecord`.
  * Never run `omarchy up` or `omarchy update` without `--help`.
  * Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The alias table is at the very end of `omarchy commands`; the sed keeps only that part.
  * ./client-with-image allows you to get an image back of what you did, so can be useful for speeding things up
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of `up --help` with `Binary: omarchy-update` and the alias table (or the recorded unknown-command output plus version for the skew case), and the idle prompt 5 s later
  * If unsuccessful
  ** an update that started (sudo prompt / package list scrolling)
covers: bin/omarchy-update:1-7; bin/omarchy:229-231,302-313,606-619,889-896; docs/cli-router.md "Dispatch" (alias fallback)
merged-from: 20:cli-alias-omarchy-up

### cli-hidden-commands-route-but-stay-unlisted   [VM-OK]
description: Hidden plumbing (`state`, `done`, `installed service …`, `sudo docker`, `cmd terminal cwd`) stays out of listings and group help yet still routes and runs when typed, so menus keep working while users are not shown internals.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy installed --help`; expected `Installed commands — Installed optional service checks:` and `No documented commands found. Try: omarchy commands --all`.
  * Type `omarchy commands --all | grep -E 'omarchy (installed service|sudo docker|cmd terminal cwd)'`; expected four rows.
  * Type `omarchy cmd --help`; expected rows `omarchy cmd missing` and `omarchy cmd present` but no `terminal cwd`.
  * Type `omarchy state --help | grep -A1 Binary`; expected `omarchy-state` — hidden commands still route.
  * Type `omarchy installed service tailscale; echo "exit=$?"` and `omarchy installed service dropbox; echo "exit=$?"`; expected `exit=1` twice (neither installed).
  * Type `omarchy done check nothing-here; echo "exit=$?"`; expected no output and `exit=1` — the hidden binary really ran.
  * Press Super+Space → Remove; there must be no `Dropbox`/`Tailscale` rows (the `Services` entry may be absent entirely — record). Press Escape until the menu closes, then Super+W on the terminal.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Menu rows are hidden by `when:` shell conditions; an empty submenu may simply not be listed. Escape in the menu is two-stage (clear filter, then close).
  * ./client-with-image allows you to get an image back of what you did, so can be useful for speeding things up
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the empty group help, the four `--all` rows, the `cmd` group help without `terminal cwd`, the routed `state --help`, the three `exit=1` lines and the Remove menu
  * If unsuccessful
  ** a hidden route in a default listing, or a hidden route failing to dispatch
covers: bin/omarchy:236-239,414-424,585-620,817-821,1032-1036; bin/omarchy-installed-service-dropbox; bin/omarchy-installed-service-tailscale; docs/cli-router.md "How a binary becomes routes"; test/cli:196-220
merged-from: 20:cli-hidden-commands-route

### agent-skill-command-contract   [VM-OK]
description: Every command the shipped `omarchy` agent skill and its topic guides tell an agent to run resolves in the router and answers `--help`, the skills are linked into the agents' skill directories, and the skill's example commands (the mandated `omarchy debug --no-sudo --print` bug-report path, `omarchy version`, a reminder) run without prompts — so an AI agent following the skill is never sent down a dead route.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `ls -l ~/.claude/skills ~/.codex/skills ~/.agents/skills 2>&1`.
  ** Each existing directory shows `omarchy ->` and `diagnose-crash ->` symlinks into `/usr/share/omarchy/default/agents/skills/` (a directory missing on 4.0.2 is recorded, not failed).
  * Type `head -3 ~/.claude/skills/omarchy/SKILL.md; omarchy commands | head -5` → `name: omarchy` front matter and a command list.
  * Type the loop below on one line, then answer the sudo prompt with `prime`:
    `for c in "theme set" "theme list" "theme current" "theme bg next" "theme install" "refresh shell" "refresh hyprland" "refresh hyprsunset" "refresh config" "restart shell" "restart terminal" "restart hyprsunset" "toggle nightlight" "bar move" "plugin clone" "plugin add" "plugin remove" "hook install" "install" "launch browser" "capture screenshot" "capture text" "capture webcam resize" "screenshot" "screenrecord" "reminder" "pkg add" "pkg aur add" "setup security fingerprint" "update" "version" "debug" "system lock" "system shutdown" "system reboot" "reinstall" "menu keybindings" "font list" "font current" "font set" "share clipboard" "share file" "tailscale send" "tailscale receive" "transcode" "default agent" "agent prompt" "agent crash" "crash mute" "toggle crash-capture" "install docker dbs"; do printf '%-28s ' "$c"; omarchy $c --help 2>&1 | grep -m1 -E '^(Usage|Unknown Omarchy|Binary)'; done 2>&1 | sudo tee /dev/ttyS0 >/dev/null`
  ** Read the serial log: one line per command, each showing `Usage` (or `Binary`). Any line containing `Unknown Omarchy command` is skill drift — quote it in the report.
  * Type `for c in omarchy-theme-set omarchy-refresh-shell omarchy-toggle-nightlight omarchy-reminder omarchy-capture-screenshot omarchy-crash-mute omarchy-debug; do command -v $c >/dev/null && echo ok $c || echo MISSING $c; done` → all `ok`.
  ** A MISSING entry names a command the skill documents but 4.0.2 lacks; report it rather than fail everything.
  * Spot-check that the skill's example strings run harmlessly: type `omarchy theme list | head -5`, `omarchy font current`, `omarchy version; omarchy version channel`, `omarchy menu keybindings --print | grep 'SUPER + F'` → each prints (themes, a font name, `4.0.2` — the installed package version, not `dev (…)` and not `4.0.0.alpha` — and `stable`, the Super+F binding).
  * Type `sudo -k; omarchy debug --no-sudo --print 2>&1 | tail -5; ls -la /tmp/omarchy-debug.log` → report lines print with NO `[sudo] password` prompt; the log file exists with a non-zero size. Then `head -30 /tmp/omarchy-debug.log | sudo tee /dev/ttyS0 >/dev/null` (password `prime`) and read the header (`Date:`, `Hostname:`, `Omarchy Package:`) with get-serial. Then `omarchy-debug --no-sudo --print | head -3` → also works (the hyphenated name the GitHub bug template asks for).
  ** Plain `omarchy debug` → a `[sudo] password for prime:` prompt appears; press Ctrl+C — the shell prompt returns and nothing was uploaded. The interactive chooser is covered by `debug-report-print-view-save-no-upload`.
  * Type `omarchy reminder 1 "Skill test"`; wait ~60 s screenshotting every 5 s → a notification "Skill test" appears. Type `omarchy reminder clear`.
  * Unhappy path: type `omarchy debug --bogus-flag; echo "exit=$?"` → `Unknown option: --bogus-flag` with the usage line and a non-zero exit.
  * Close the terminal with Super+W; the desktop is as before.
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
  ** Screenshots of the symlink listings and the SKILL head with the command list
  ** Serial dump with one Usage/Binary fragment per command and zero `Unknown Omarchy command` lines (or each drift line quoted); the `ok` table
  ** Screenshots of the spot-checks including the `4.0.2` / `stable` version lines, the debug tail with the log file size and no prompt, the serial header of the log, the hyphenated `omarchy-debug` head, the sudo prompt from plain `omarchy debug` before Ctrl+C, the reminder notification, and the bogus-flag error
  * If unsuccessful
  ** Serial dump; screenshot of the failing command run by hand; broken symlinks, MISSING commands, a sudo prompt during `--no-sudo` (full stderr of `omarchy debug --no-sudo --print`), or no reminder notification
covers: default/agents/skills/omarchy/SKILL.md §Command Groups, §System Commands, §Troubleshooting, §Example Requests; default/agents/skills/omarchy/{hyprland,plugins,theming,hooks,capture,contributing}.md; default/agents/skills/diagnose-crash/*.md (reporting.md §Filing a new issue); docs/file-layout.md (skill symlinks); docs/update-process.md §Channels and versions; .github/ISSUE_TEMPLATE/bug.yml; test/shell.d/default-agent-test.sh
merged-from: 61:agent-skill-commands-resolve; 41:agent-skill-commands-work; 61:agent-skill-debug-and-version

### state-done-markers-and-name-guards   [VM-OK]
description: The hidden `omarchy state` and `omarchy done` primitives persist toggles and once-only markers under `~/.local/state/omarchy`: set/mark/ensure create files, clear removes them, `state set reboot-required` is what lights the bar's reboot indicator, and names with `..` or slashes are refused and create nothing outside their directories.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy state set qa-marker; ls ~/.local/state/omarchy/ | grep qa-marker`; expected `qa-marker`.
  * Type `omarchy state set ../escape; echo "exit=$?"; omarchy state set sub/dir; echo "exit=$?"`; expected `Invalid state name: ../escape`, `exit=2`, then `exit=2`; `ls ~/.local/state/ | grep -c escape` prints `0` — nothing created outside the directory.
  * Type `omarchy state clear 'qa-*'; ls ~/.local/state/omarchy/ | grep -c qa-marker`; expected `0`. Then `omarchy state set; echo "exit=$?"`; the leftover `set` is forwarded past the router's required-args guard, so expected `Usage: omarchy-state set <state-name>` and `exit=1`.
  * Type `omarchy state set reboot-required` — a reboot-required indicator appears in the bar; screenshot; type `omarchy state clear reboot-required` — it disappears.
  * Type `omarchy done check qa-task; echo "exit=$?"`; expected `exit=1`. Then `omarchy done ensure qa-task; echo "exit=$?"; omarchy done ensure qa-task; echo "exit=$?"; omarchy done check qa-task; echo "exit=$?"; omarchy done mark qa-task; echo "exit=$?"`; expected `exit=0`, `exit=1` (already ensured), `exit=0`, `exit=0` (mark is idempotent), and `ls ~/.local/state/omarchy/done/` lists `qa-task`.
  * Unhappy paths: `omarchy done bogus qa-task; echo "exit=$?"` → `Usage: omarchy-done <check|mark|ensure> <name>`, `exit=1`; `omarchy done check; echo "exit=$?"` → the same usage, `exit=1`; `omarchy done mark ../oops; echo "exit=$?"` → `Invalid done marker name: ../oops`, `exit=1`; `omarchy done mark a/b; echo "exit=$?"` → `Invalid done marker name: a/b`, `exit=1`.
  ** The codes differ by design: a bad *state* name exits 2, a bad *done* name exits 1; record if the build differs.
  * Type `rm ~/.local/state/omarchy/done/qa-task` so no marker is left behind, then Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Both commands are hidden but route normally; the proof is the `ls` output, not the (silent) command — chain every call with `; echo "exit=$?"` so the code is on screen.
  * Exit code 2 is the specific "bad name" status for `state`; a 1 there would mean something else went wrong.
  * ./client-with-image allows you to get an image back of what you did, so can be useful for speeding things up
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots: `qa-marker` listed then count `0`, the `../escape` and `sub/dir` refusals with `exit=2` and nothing under `~/.local/state/`, the forwarded `set` usage with `exit=1`
  ** Screenshot of the reboot indicator on and then off
  ** Screenshot of the done sequence `1 0 1 0 0` for check/ensure/ensure/check/mark with `qa-task` listed, and the four done refusals with `exit=1`
  * If unsuccessful
  ** a file created outside `~/.local/state/omarchy`, `../` accepted, or a refusal with the wrong status
covers: bin/omarchy-state; bin/omarchy-done; test/shell.d/hook-state-name-guard-test.sh; test/shell.d/done-test.sh; docs/file-layout.md (Completion markers); manual/31-dotfiles.md
merged-from: 20:state-and-done-markers; 42:done-markers-cli; 51:hook-state-done-name-guards

### hooks-install-run-theme-set-and-reject   [VM-OK]
description: User hooks are the supported extension point: `omarchy hook install` copies a script into `~/.config/omarchy/hooks/<type>.d/`, `omarchy hook <type>` runs every hook there (and a single-file `hooks/<type>`) with its arguments, a theme or font change fires the matching hook with the new name in `$1`, a failing hook is reported without aborting, and bad names or missing files are refused.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `ls ~/.config/omarchy/hooks/ ~/.config/omarchy/hooks/post-update.d/`; expected six directories (`battery-low.d font-set.d post-boot.d post-update.d pre-refresh-pacman.d theme-set.d`) and the shipped `install-voxtype.hook setup-fingerprint.hook setup-agent.hook`.
  ** One reviewer expected the directory to be absent on a fresh install — record what you see.
  * Type `printf '#!/bin/bash\necho "hello from hook $*"\n' > /tmp/hi.sh && omarchy hook install post-update /tmp/hi.sh && ls -l ~/.config/omarchy/hooks/post-update.d/hi.sh`; expected `Installed post-update hook: /home/prime/.config/omarchy/hooks/post-update.d/hi.sh` and `-rwxr-xr-x`. Then `omarchy hook post-update one two; echo "exit=$?"`; expected `hello from hook one two`, `exit=0`.
  ** The three shipped hooks run too: on a minted disk they may show the Voxtype/agent invitation toasts exactly once — expected, record them.
  * Type `printf '#!/bin/bash\nexit 1\n' > /tmp/bad.sh && omarchy hook install post-update /tmp/bad.sh && omarchy hook post-update; echo "exit=$?"`; expected the hello line, then `Hook failed: /home/prime/.config/omarchy/hooks/post-update.d/bad.sh`, and `exit=0` — a failing hook does not abort the runner.
  * Theme and font hooks: type `printf '#!/bin/bash\necho "$1" > /tmp/hook-theme.txt\nomarchy-notification-send "Hook ran for $1"\n' > /tmp/theme-hook.sh && omarchy hook install theme-set /tmp/theme-hook.sh && printf '#!/bin/bash\necho "font hook got: $1" >> /tmp/hooklog\n' > ~/.config/omarchy/hooks/font-set && chmod +x ~/.config/omarchy/hooks/font-set`. Then `omarchy theme set nord`: within 5 s the desktop is Nord and a toast `Hook ran for nord` appears; `cat /tmp/hook-theme.txt` → `nord`. Then `omarchy-font-set "JetBrainsMono Nerd Font"` (re-sets the current font; the bar restarts) and `cat /tmp/hooklog` → `font hook got: JetBrainsMono Nerd Font`.
  ** The shipped sample works the same way: `cd ~/.config/omarchy/hooks/theme-set.d && mv show-theme-notification.sample show-theme-notification && sed -i 's/^# omarchy-notification-send/omarchy-notification-send/' show-theme-notification && chmod +x show-theme-notification && cd ~` (its last line is now `omarchy-notification-send -u low "New theme" "Your new theme is $1"`), then `omarchy theme set gruvbox` → the desktop turns Gruvbox with a `New theme — Your new theme is gruvbox` notification beside your `Hook ran for gruvbox` toast.
  * Unhappy paths: `omarchy hook install post-update /nope; echo "exit=$?"` → `Hook file not found: /nope`, `exit=1`; `omarchy hook ../x; echo "exit=$?"` and `omarchy hook install ../x /tmp/hi.sh; echo "exit=$?"` → `Invalid hook name: ../x`, `exit=2` both times; `omarchy hook install; echo "exit=$?"` → usage, non-zero; `omarchy hook; echo "exit=$?"` → quirk: the metadata calls the name optional but the script prints `Usage: omarchy-hook [name] [args...]` with `exit=1`. `ls ~/.config/omarchy/hooks/theme-set.d/` still shows only your hook and the sample; nothing exists under a `..` path.
  * Restore: `rm ~/.config/omarchy/hooks/post-update.d/hi.sh ~/.config/omarchy/hooks/post-update.d/bad.sh ~/.config/omarchy/hooks/theme-set.d/theme-hook.sh ~/.config/omarchy/hooks/font-set /tmp/hi.sh /tmp/bad.sh /tmp/theme-hook.sh /tmp/hook-theme.txt /tmp/hooklog && mv ~/.config/omarchy/hooks/theme-set.d/show-theme-notification ~/.config/omarchy/hooks/theme-set.d/show-theme-notification.sample && omarchy theme set tokyo-night` → the desktop is stock (the wallpaper may have advanced — re-applying a theme does that) and NO hook toast appears; `omarchy hook post-update; echo "exit=$?"` → nothing from your hooks, `exit=0`. Close the terminal with Super+W.
  ** Never `rm -r` the `post-update.d` directory: it holds the shipped hooks. Their once-only markers may have been set by this test — if a later test needs the pristine invitations, end with `stop`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The theme switch animates for a second; screenshot after the bar has recoloured. Hook toasts are low-urgency and fade after ~5 s — screenshot right after the theme changes.
  * The `Hook failed` line may scroll past quickly; the files under `/tmp` are the durable proof the hooks ran.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the hooks listing, the install line, `hello from hook one two`, and the `Hook failed:` line with `exit=0`
  ** Screenshot of the `Hook ran for nord` toast over the Nord desktop, `nord` in the file, the `font hook got:` line, and the `New theme — Your new theme is gruvbox` notification from the shipped sample
  ** Screenshot of the refusals with `exit=1` / `exit=2`, the bare-hook usage, and the switch back to tokyo-night with no hook toast
  * If unsuccessful
  ** a hook written under a path containing `..`, the runner aborting after the failing hook, or a theme switch that aborted; `ls -la ~/.config/omarchy/hooks/*/`, `journalctl --user -n 30`, `./client get-serial`
covers: bin/omarchy-hook; bin/omarchy-hook-install; bin/omarchy-theme-set (omarchy-hook theme-set); bin/omarchy-font-set (omarchy-hook font-set); config/omarchy/hooks/*.d; config/omarchy/hooks/theme-set.d/show-theme-notification.sample; test/shell.d/hook-state-name-guard-test.sh; manual/31-dotfiles.md (Running scripts on system events); docs/theming.md:40-42 (theme-set hook); default/agents/skills/omarchy/hooks.md; SKILL.md ("Run a script every time I change themes")
merged-from: 20:hook-install-run-and-reject; 12:hooks-theme-set-sample-and-install; 21:theme-hooks-theme-set-and-font-set; 61:theme-set-hook-runs

### debug-report-print-view-save-no-upload   [VM-PARTIAL]
description: `omarchy debug` produces the support report non-interactively (`--print --no-sudo` streams it with dmesg skipped and no password prompt) and through its sudo + gum chooser that views or saves the log in the current directory, and refuses a bad flag; `Upload log` is gated on `ping 8.8.8.8`, which this guest blocks, so the option must be absent and the upload itself is skipped.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `cd ~ && omarchy debug --print --no-sudo | head -n 8`; expected `Date: …`, `Hostname: …`, `Omarchy Package: omarchy 4.0.…`, then the `SYSTEM INFORMATION` banner, and no sudo prompt.
  * Type `grep -c 'skipped - --no-sudo' /tmp/omarchy-debug.log; grep -cE '^(DMESG|INSTALLED PACKAGES|JOURNALCTL)' /tmp/omarchy-debug.log`; expected `1` then `3` — the DMESG section says `(skipped - --no-sudo flag used)`.
  * Unhappy path: type `omarchy debug --bogus; echo "exit=$?"`; expected `Unknown option: --bogus`, `Usage: omarchy-debug [--no-sudo] [--print]`, `exit=1`.
  * Type `omarchy debug`; enter `prime` at the `[sudo] password` prompt and wait up to 20 s (inxi + journal).
  ** Expected a gum chooser with exactly `View log` and `Save in current directory`; `Upload log` must be ABSENT — record the options shown. If it IS offered, ICMP works in this harness: note it and do not upload. (`omarchy debug --no-sudo` reaches the same chooser without a password.)
  ** Stay in `~`: the report lives at `/tmp/omarchy-debug.log`, and saving from `/tmp` would copy it onto itself.
  * Choose `View log` (Enter): `less` shows the report with `Date:`, `Hostname:`, `Omarchy Package: omarchy 4.0…` and `SYSTEM INFORMATION`; press `q`.
  * Type `omarchy debug` again (`prime` if asked), press Down to `Save in current directory`, Enter; expected `✓ Log saved to /home/prime/omarchy-debug.log`.
  * Type `ls -l ~/omarchy-debug.log; head -n 2 ~/omarchy-debug.log; grep -E '^(SYSTEM INFORMATION|DMESG|JOURNALCTL|INSTALLED PACKAGES)' ~/omarchy-debug.log; grep -c virtio ~/omarchy-debug.log`; a file of at least 50 KB starting `Date:`, the four section headers, and a non-zero count (dmesg captured this time).
  * Type `rm ~/omarchy-debug.log` to leave the home directory as found, then Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * gum choose highlights the current row; Up/Down move, Enter selects.
  * The report takes 10–20 s to gather (inxi is slow); keep screenshotting rather than sleeping.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the report header with no password prompt, the two grep counts, and the `--bogus` refusal with `exit=1`
  ** Screenshot of the chooser documenting which options were present (no `Upload log`), `less` on the report header, the `✓ Log saved` line, the `ls -l` size, the section-header grep and the virtio count
  * If unsuccessful
  ** a sudo prompt despite `--no-sudo`, a chooser that never appears or that offers `Upload log`, a missing section or saved file, or inxi/expac/journalctl errors in the report
covers: bin/omarchy-debug; manual/45-troubleshooting.md; manual/45:5; manual/14:25; 13-manual-rest.md Observations #13
merged-from: 20:debug-report-print-and-save; 10:omarchy-debug-print-and-upload-hidden; 13:omarchy-debug-collects-log-hides-upload-offline; 24:debug-report-and-menu-without-upload

### upload-log-cli-installed-and-rejects   [VM-OK] [NET]
description: The hidden `omarchy upload log <type>` posts a support bundle to logs.omarchy.org and prints a shareable URL (a few hundred KB up); an unknown type prints usage and the bare route shows help.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy upload log bogus; echo "exit=$?"`; expected `Usage: … [install|this-boot|last-boot|installed|system-info]` with the option lines, `exit=1`.
  * Type `omarchy upload log; echo "exit=$?"`; expected the router help for `omarchy upload log <log-file>`, `exit=0`.
  * Type `omarchy upload log installed; echo "exit=$?"`; expected `Uploading system information to logs.omarchy.org...`, `✓ Log uploaded successfully!`, `Share this URL:` and a `https://logs.omarchy.org/…` URL, `exit=0` (allow 60 s).
  * Type `omarchy upload log last-boot; echo "exit=$?"`; on a first boot expect either a URL or `Error: No logs found for previous boot` with `exit=1` — record which.
  * Type `omarchy commands | grep -c 'upload log'`; expected `0` (hidden).
  * Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The upload can take up to a minute on the VM's link; screenshot every 5 s rather than sleeping.
  * ./client-with-image allows you to get an image back of what you did, so can be useful for speeding things up
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the usage refusal, the router help, the `✓ Log uploaded successfully!` line with its URL, the `last-boot` outcome and the `0` count
  * If unsuccessful
  ** `Error: Failed to upload log file`, or a hang beyond 60 s
covers: bin/omarchy-upload-log
merged-from: 20:upload-log-installed-and-rejects

### dev-link-scratch-status-and-unlink   [VM-OK]
description: A developer points Omarchy at a checkout and back without rebooting: `omarchy dev status` reports the stock install, `dev link <path> --no-reboot` writes `/etc/omarchy.conf` and a valid root-owned sudoers drop-in so sudo resolves `omarchy-*` from the checkout, status reports the link and the session mismatch while new shells already read the path, and `dev unlink --no-reboot` restores everything.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy dev status; cat /etc/omarchy.conf; ls /etc/sudoers.d/omarchy-dev-path 2>&1`; expected `dev-link: inactive`, `current shell:       OMARCHY_PATH=/usr/share/omarchy`, no `Note:` line, `export OMARCHY_PATH="/usr/share/omarchy"` (or no conf) and no drop-in.
  * Type `cp -r /usr/share/omarchy /tmp/checkout && omarchy dev link /tmp/checkout --no-reboot; echo "exit=$?"`; enter `prime`; expected `Pointed Omarchy at /tmp/checkout`, `sudo now resolves omarchy-* from /tmp/checkout/bin`, `exit=0`, and NO reboot question.
  * Type `cat /etc/omarchy.conf; sudo cat /etc/sudoers.d/omarchy-dev-path; sudo stat -c '%U:%G %a' /etc/sudoers.d/omarchy-dev-path; sudo visudo -c | tail -1`; expected `export OMARCHY_PATH="/tmp/checkout"`, `Defaults secure_path="/tmp/checkout/bin:/usr/local/sbin:/usr/local/bin:/usr/bin"`, `root:root 440`, and sudoers parsed OK.
  * Type `sudo true; omarchy dev status`; expected `dev-link: configured`, `/etc/omarchy.conf -> OMARCHY_PATH=/tmp/checkout`, `sudo resolves omarchy-* from: /usr/bin` (or `/usr/share/omarchy/bin`), `status: reboot required …`, `current shell: OMARCHY_PATH=/usr/share/omarchy`, and `Note: the running session does not match /etc/omarchy.conf. Reboot to settle it.`
  ** Press Super+Enter for a second terminal and type `echo $OMARCHY_PATH; echo ${PATH%%:*}` — a new shell already reads the conf: `/tmp/checkout` and `/tmp/checkout/bin`. Close it with Super+W.
  * Type `omarchy dev unlink --bogus; echo "exit=$?"`; expected `Usage: omarchy dev unlink [--no-reboot]`, `exit=1`, still linked.
  * Type `omarchy dev unlink --no-reboot; echo "exit=$?"`; expected `Pointed Omarchy at /usr/share/omarchy`, `exit=0`.
  ** Without `--no-reboot` a gum `Reboot now to activate?` Yes/No box appears — if you ever see it, answer No (Right arrow then Enter, or `n`).
  * Type `cat /etc/omarchy.conf; sudo test -f /etc/sudoers.d/omarchy-dev-path; echo "sudoers=$?"; omarchy dev status; rm -rf /tmp/checkout`; expected `export OMARCHY_PATH="/usr/share/omarchy"`, `sudoers=1`, `dev-link: inactive` with a `(default guard)` line and no `Note:`.
  * Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * SAFETY: never reboot while linked to the scratch checkout and answer No to any `Reboot now to activate?`; always finish with the unlink step even if an earlier step failed. The running desktop keeps its old path until a reboot; do not reboot for this test.
  * `unknown (needs sudo)` in the status means the cached credential expired — run `sudo true` and repeat.
  * The `cp -r` of `/usr/share/omarchy` takes a few seconds; keep screenshotting.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the stock status, the link output, the conf/sudoers/mode/visudo output, the configured status with the mismatch note, the new terminal's path, the `--bogus` usage, the unlink output, and the restored inactive status without a drop-in
  * If unsuccessful
  ** `Error: refusing to install an invalid … sudoers`, a status that does not follow the link, or a sudoers drop-in left behind after unlink; `sudo visudo -c`
covers: bin/omarchy-dev-link; bin/omarchy-dev-unlink; bin/omarchy-dev-status; default/bash/env-bootstrap; test/shell.d/dev-link-test.sh; test/shell.d/dev-unlink-test.sh; test/shell.d/dev-env-path-test.sh
merged-from: 20:dev-link-scratch-and-unlink; 51:dev-link-unlink-roundtrip

### dev-link-rejects-bad-input   [VM-OK]
description: `omarchy dev link` refuses a missing path, a wrong second argument and running under sudo, and shows help for the bare route — all before writing anything.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy dev link; echo "exit=$?"`; expected the router help (`omarchy dev link <path-to-checkout> [--no-reboot]`, `Binary: omarchy-dev-link`), `exit=0`, no sudo prompt.
  * Type `omarchy dev link /does/not/exist --no-reboot; echo "exit=$?"`; expected `Error: path does not exist: /does/not/exist`, `exit=1`, no sudo prompt.
  * Type `omarchy dev link /tmp --wrong; echo "exit=$?"`; expected `Usage: omarchy dev link <path-to-checkout> [--no-reboot]`, `exit=1`.
  * Type `sudo omarchy-dev-link /tmp --no-reboot; echo "exit=$?"` (password `prime`); expected `Error: run omarchy-dev-link as your user, not under sudo.`, `exit=1`.
  * Type `cat /etc/omarchy.conf 2>&1; ls /etc/sudoers.d/omarchy-dev-path 2>&1; omarchy dev status | head -n 1`; the conf is absent or `/usr/share/omarchy`, no drop-in, status `dev-link: inactive`.
  * Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * None of these steps should ask for a password except the deliberate `sudo` one; a password prompt elsewhere means something is about to be written — press Ctrl+C and report.
  * ./client-with-image allows you to get an image back of what you did, so can be useful for speeding things up
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the four refusals with exit codes and the unchanged conf/status
  * If unsuccessful
  ** an unexpected sudo prompt or a written `/etc/omarchy.conf`
covers: bin/omarchy-dev-link:10-13,26-60,81-84
merged-from: 20:dev-link-rejects-bad-input

### dev-benchmarks-cli-and-theme-switcher   [VM-OK] [SLOW]
description: The two developer benchmarks run to completion and print their timing tables: `dev benchmark cli` for router latency, `dev benchmark theme switcher` (also via its `theme-switcher` alias) for preview/thumbnail caches; `--repeat` is validated.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `ls /tmp | grep -c '^tmp\.'`; note the count. Then `omarchy dev benchmark cli --repeat=1; echo "exit=$?"`; expected `Omarchy CLI benchmark (1 runs each)` and 9 rows (`omarchy`, `omarchy --help`, `omarchy commands`, …, `omarchy theme current`) each with `avg … ms  min … ms  max … ms`, `exit=0`, no `failed (exit N)` row.
  * Type `omarchy dev benchmark cli --repeat=0; echo "exit=$?"`; expected `--repeat must be a positive integer`, `exit=2`.
  * Type `omarchy dev benchmark theme-switcher --repeat=1; echo "exit=$?"` and screenshot every 5 s (1–3 minutes on 2 vCPU).
  ** Expected `Theme switcher benchmark (1 warm runs each)`, rows `theme index cold/warm`, `selector prep cold/warm (lazy)`, `thumbnail cache cold/warm`, then `Theme previews: N` with N ≥ 10, `exit=0`.
  * Type `omarchy dev benchmark theme switcher --repeat=x; echo "exit=$?"`; expected `--repeat must be a positive integer`, `exit=2`.
  * Type `ls /tmp | grep -c '^tmp\.'`; the benchmark removed its temporary caches (count unchanged from the first step, typically `0`).
  * Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The theme benchmark is CPU-bound and silent for long stretches; keep screenshotting, it has not hung until 5 minutes pass.
  * ./client-with-image allows you to get an image back of what you did, so can be useful for speeding things up
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the 9 CLI rows, the theme-switcher table with `Theme previews: N`, the two `--repeat` refusals with `exit=2`, and the unchanged tmp count
  * If unsuccessful
  ** a `failed (exit N)` row, a magick/`omarchy-menu-images` error, or a preview count of 0
covers: bin/omarchy-dev-benchmark-cli; bin/omarchy-dev-benchmark-theme-switcher; test/cli:235-236
merged-from: 20:dev-benchmarks

### dev-theme-preview   [VM-OK]
description: `omarchy dev theme preview` renders a theme's palette (swatches, ramp, samples) for the current or a named theme, falls back to `#` swatches with `--no-color`, and fails cleanly for an unknown theme or extra arguments.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy dev theme preview --no-osc; echo "exit=$?"`; expected `Theme: …`, `File: /home/prime/.local/state/omarchy/current/theme/colors.toml`, `Mode: dark|light`, `foreground/background contrast: N:1`, a gradient bar, `Neutral ramp`, `Foundation`, `Selection sample`, `Terminal/UI samples`, `ANSI palette strips`, coloured swatches, `exit=0`.
  * Type `omarchy dev theme preview tokyo-night --no-osc | head -n 3`; expected `Theme: tokyo-night`, `File: /usr/share/omarchy/themes/tokyo-night/colors.toml`.
  * Type `omarchy dev theme preview "Tokyo Night" --no-color | grep -c '####'`; a count > 10 (plain swatches; the display name is accepted).
  * Unhappy path: type `omarchy dev theme preview no-such-theme-qa; echo "exit=$?"`; expected `Theme not found: no-such-theme-qa`, `exit=1`. Then `omarchy dev theme preview a b; echo "exit=$?"`; expected the usage text, `exit=1`.
  * Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Keep `--no-osc` on: without it the preview recolours this terminal's palette until it is closed, which would confuse later screenshots.
  * The first preview is ~40 lines; if it scrolls, add `| head -n 30`.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the coloured preview, the tokyo-night header, the `#` swatch count, and the two refusals with `exit=1`
  * If unsuccessful
  ** `Missing colors.toml`, empty swatches, or an `omarchy-theme-color` error
covers: bin/omarchy-dev-theme-preview; test/cli:431-437
merged-from: 20:dev-theme-preview

### dev-font-list-and-add-glyph   [VM-OK]
description: `omarchy dev font` lists the shipped icon font's private-use brand glyphs and adds a new one from a single-path SVG into a writable copy, refusing multi-path SVGs, taken codepoints, a missing SVG and the read-only packaged font — which is never corrupted.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy dev font list | head -n 5; omarchy dev font list | wc -l` → rows `U+E900 … U+E90E`, each `U+E9xx  <glyph>  <name>  <W> x <H>`, and the count `15`.
  * Type `omarchy dev font; echo "exit=$?"`; the metadata declares required args, so the router help (`omarchy dev font [list|add] <name> …`) prints, `exit=0`.
  * Type `cp /usr/share/omarchy/default/fonts/omarchy/omarchy.ttf /tmp/f.ttf && printf '<svg viewBox="0 0 24 24"><path d="M2 2h20v20H2z"/></svg>' > /tmp/sq.svg && omarchy dev font add square /tmp/sq.svg --font /tmp/f.ttf; echo "exit=$?"` → `Added square as U+E90F (…)`, a `Next:` list, `exit=0`; `omarchy dev font list --font /tmp/f.ttf | grep square` shows the new row.
  * Refusals against the copy: `omarchy dev font add again /tmp/sq.svg --font /tmp/f.ttf --codepoint U+E900; echo "exit=$?"` → `U+E900 is already used`, `exit=1`. Then `printf '<svg viewBox="0 0 24 24"><path d="M0 0h1v1z"/><path d="M2 2h1v1z"/></svg>' > /tmp/two.svg && omarchy dev font add two /tmp/two.svg --font /tmp/f.ttf; echo "exit=$?"` → `expected a single <path>, found 2 — flatten the mark to one monochrome path first`, non-zero. Then `omarchy dev font add qa /nonexistent.svg --font /tmp/f.ttf; echo "exit=$?"` → a Python error naming `No such file or directory: '/nonexistent.svg'`, non-zero (record whether it is a raw traceback — that is a finding).
  * Packaged font: `omarchy dev font add x /tmp/sq.svg; echo "exit=$?"` → a `PermissionError` / `Permission denied` on `/usr/share/omarchy/default/fonts/omarchy/omarchy.ttf`, non-zero; `omarchy dev font list | wc -l` still `15` and `omarchy dev font list | grep -c x` unchanged.
  * Type `rm /tmp/f.ttf /tmp/*.svg` and close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The glyph characters print in the private-use area; boxes instead of marks in the *terminal* are fine — the codepoint column is the proof (the menu tests check rendering).
  * ./client-with-image allows you to get an image back of what you did, so can be useful for speeding things up
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the 15-row list, the router help, `Added square as U+E90F` with the new row in the copy, the three refusals with their exception text, and the permission error with the stock list still 15 rows
  * If unsuccessful
  ** the package font modified (`pacman -Qkk omarchy | grep omarchy.ttf`), `list` failing on the stock font, or a Python traceback text
covers: bin/omarchy-dev-font:456-482,552-649; default/fonts/omarchy/{omarchy.ttf,README.md}; agents/skills/icon-font.md
merged-from: 21:dev-font-add-glyph; 20:dev-font-list-and-add

### dev-pkg-test-without-checkout   [VM-PARTIAL]
description: `omarchy dev pkg test` needs a local PKGBUILD tree the VM lacks; it must explain the missing checkout/PKGBUILD and show its help without attempting a build or asking for sudo (the build itself is not runnable here).
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy dev pkg test --help | head -n 2`; expected `Usage: omarchy dev pkg-test [package-name] [path-to-checkout]`.
  * Type `omarchy dev pkg test; echo "exit=$?"`; expected `Error: checkout not found at /home/prime/Work/omarchy/omarchy-installer`, `exit=1`, no sudo prompt.
  * Type `mkdir -p /tmp/co && omarchy dev pkg test omarchy /tmp/co; echo "exit=$?"`; expected `Error: PKGBUILD not found at /home/prime/Work/omarchy/omarchy-pkgs/pkgbuilds/omarchy-dev/PKGBUILD` and the `OMARCHY_PKGBUILDS_DIR` hint, `exit=1`.
  * Type `omarchy dev pkg-test 2>&1 | head -n 1`; the hyphenated spelling gives the same checkout error.
  * Type `rmdir /tmp/co` and close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * A `makepkg` or sudo prompt here would mean the guard failed — Ctrl+C and report.
  * ./client-with-image allows you to get an image back of what you did, so can be useful for speeding things up
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the help and the two explanatory errors with `exit=1`, and the hyphenated spelling's matching error
  * If unsuccessful
  ** a makepkg/sudo prompt without a checkout, or an unhandled bash error
covers: bin/omarchy-dev-pkg-test:10-96
merged-from: 20:dev-pkg-test-missing-checkout

### dev-ui-preview-gallery   [VM-PARTIAL]
description: `omarchy dev ui preview [section]` summons the shell's component gallery; if the packaged shell ships the dev-gallery plugin the panel opens (and jumps to a section), otherwise the command must fail visibly rather than hang.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy dev ui preview; echo "exit=$?"`.
  ** Expected either a gallery panel of shell widgets (buttons, sliders, toggles…) with `exit=0`, or an `omarchy-shell` error naming `omarchy.dev-gallery`. Record which.
  * If the gallery opened, press Escape, then type `omarchy dev ui preview slider`; the gallery opens scrolled to the slider section. Escape again.
  * Type `omarchy dev ui preview --help | grep -A1 Usage`; expected `omarchy dev ui preview [section]`.
  * Close the terminal with Super+W; no overlay remains.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The gallery is a shell overlay, not a window; if nothing appears within 3 s and no error printed, report a hang.
  * ./client-with-image allows you to get an image back of what you did, so can be useful for speeding things up
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the gallery panel (and its slider section) or of the explicit shell error, and the help line
  * If unsuccessful
  ** silence with no panel and no error
covers: bin/omarchy-dev-ui-preview
merged-from: 20:dev-ui-preview-gallery

### dev-install-ydoo   [VM-OK] [NET]
description: `omarchy dev install ydoo` installs and enables ydotool for UI automation: it adds the user to `input` and writes the udev rule through polkit dialogs, installs the package (~1 MB), starts the user service and prints "ydotool is ready." — and is idempotent on a second run.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy dev install ydoo; echo "exit=$?"`.
  ** Expected `Adding prime to the input group. You may need to log out and back in before this applies.` then a polkit password dialog on the desktop — click it, type `prime`, Enter.
  ** Then the `ydotool` install (a terminal sudo prompt may appear; enter `prime`), then a second polkit dialog for the udev rule — authenticate again.
  * Expected final line `ydotool is ready.`, `exit=0`.
  * Type `systemctl --user is-active ydotool.service; ls -l /dev/uinput; cat /etc/udev/rules.d/80-uinput.rules`; expected `active`, group `input` mode `crw-rw----`, and the `KERNEL=="uinput", GROUP="input"…` rule.
  * Type `omarchy dev install ydoo; echo "exit=$?"` again; no group message this time, at most one polkit prompt, and `ydotool is ready.` — idempotent.
  * Close the terminal with Super+W.
  ** This test leaves ydotool installed, the user in `input` and the udev rule in place: end the session with `stop` (do not `save`).
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Polkit dialogs are floating windows, not terminal prompts; move the mouse over them before typing.
  * double checking your mouse position before clicking can be useful to prevent failure.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the polkit dialog, `ydotool is ready.` with `exit=0`, the service/device/rule checks, and the idempotent second run
  * If unsuccessful
  ** `omarchy-dev-install-ydoo: ydotool.service did not start` with its status dump, or a pkexec authorization error
covers: bin/omarchy-dev-install-ydoo
merged-from: 20:dev-install-ydoo

### transcode-picture-cli-and-rejects   [VM-OK]
description: `omarchy transcode <file> <format> <resolution>` writes `<stem>-<resolution>.<format>` beside the input, copies it to the clipboard and toasts; bad paths, formats, resolutions and options are refused with clear messages.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `magick -size 1600x900 gradient:red-blue ~/Pictures/qa.png && ls ~/Pictures/`; `qa.png` exists.
  * Type `omarchy transcode ~/Pictures/qa.png jpg low; echo "exit=$?"`; expected toast `Transcoded to low jpg` / `Saved and copied to clipboard.`, `exit=0`.
  * Type `magick identify ~/Pictures/qa-low.jpg; wl-paste`; expected a JPEG 1080 px wide and `file:///home/prime/Pictures/qa-low.jpg`.
  * Unhappy paths: `omarchy transcode /nope.png jpg low; echo "exit=$?"` → `File not found: /nope.png`, `exit=1`. Then `omarchy transcode ~/Pictures/qa.png bmp low; echo "exit=$?"` and `omarchy transcode ~/Pictures/qa.png jpg huge; echo "exit=$?"` → `Invalid picture format: bmp` and `Invalid picture resolution: huge`, `exit=1` each. Then `omarchy transcode --bogus; echo "exit=$?"` → `Unknown option: --bogus` + usage, `exit=2`.
  * Type `ls ~/Pictures/` — no file was produced by the refusals; then `rm ~/Pictures/qa.png ~/Pictures/qa-low.jpg` to leave Pictures as found.
  * Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Screenshot immediately after the transcode command — the toast fades in a few seconds.
  * `low` means "shrink to 1080 px wide"; the 1600 px source is reduced, never enlarged.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the toast, the `identify` line with 1080 width, the clipboard URI, and each refusal with its exit code
  * If unsuccessful
  ** a magick error, a missing output, or a refusal that still produced a file
covers: bin/omarchy-transcode
merged-from: 20:transcode-picture-cli-and-reject

### transcode-ascii-cli-and-rejects   [VM-OK]
description: `omarchy transcode ascii` converts an SVG/PNG to braille or block art with width/height/mode/threshold controls and rejects a missing image, a bad mode or missing arguments — the converter behind both "Set From Image" branding entries.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy transcode ascii /usr/share/omarchy/logo.svg /tmp/logo-braille.txt --width 60; echo "exit=$?"; cat /tmp/logo-braille.txt; wc -L /tmp/logo-braille.txt`.
  ** `Wrote ASCII art to /tmp/logo-braille.txt`, `exit=0`, then braille-dot art of the Omarchy wordmark, max line length ≤ 60.
  * Type `omarchy transcode ascii /usr/share/omarchy/logo.svg /tmp/logo-block.txt --mode block --width 40 && cat /tmp/logo-block.txt` → the same logo shape in `█ ▀ ▄` blocks, ≤ 40 columns. Then `omarchy transcode ascii /usr/share/omarchy/icon.png /tmp/icon-block.txt --mode block --width 40 --height 20 && cat /tmp/icon-block.txt` → block art ≤ 40 columns, ≤ 20 rows.
  * Type `omarchy transcode ascii /usr/share/omarchy/icon.png /tmp/icon-inv.txt --invert --threshold 30 && cat /tmp/icon-inv.txt` → a visibly different (inverted/denser) rendering.
  * Unhappy paths: `omarchy transcode ascii /nope.svg /tmp/x.txt; echo "exit=$?"` → `Logo file not found: /nope.svg`, `exit=1`. `omarchy transcode ascii /usr/share/omarchy/icon.png /tmp/x.txt --mode ansi; echo "exit=$?"` → `Invalid mode: ansi (expected braille or block)`, `exit=1`. `omarchy transcode ascii /usr/share/omarchy/logo.svg; echo "exit=$?"` → `Usage: omarchy-transcode-ascii <input-image.svg|png> <output-path> [options]`, `exit=1`. `omarchy transcode ascii --help` → the options list.
  ** `ls /tmp/x.txt 2>&1` → `No such file`: no refusal produced an output file.
  * Clean up: `rm -f /tmp/logo-braille.txt /tmp/logo-block.txt /tmp/icon-block.txt /tmp/icon-inv.txt` and close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If the art looks like a solid blob, note it; the manual says `--threshold` is the knob, and 30/70 should show a difference.
  * Braille output can look faint on screenshots; the block variant is the easier one to verify visually.
  * ./client-with-image allows you to get an image back of what you did, so can be useful for speeding things up
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the `Wrote ASCII art` line with `exit=0`, the braille and block renderings (logo and icon) with their sizes, the inverted variant, the three refusals with `exit=1` and no stray output file, and the help
  * If unsuccessful
  ** a magick error (`Unable to read logo image` / `Unable to convert logo image`), an empty output file, `./client get-serial`
covers: bin/omarchy-transcode-ascii; manual/41-branding.md (Converting images yourself)
merged-from: 12:transcode-ascii-cli-and-reject; 20:transcode-ascii-from-logo

### disk-speedtest-cli-and-panel   [VM-OK]
description: The disk speed test streams read then write MB/s for the disk behind a directory, cleans up its scratch files, refuses a non-directory, and the Trigger → Speed Test → Disk Speed Test panel drives the same command with dials.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy disk speedtest /not/a/dir; echo "exit=$?"`; expected `Usage: omarchy-disk-speedtest [target-dir]`, `exit=2`.
  * Type `omarchy disk speedtest; echo "exit=$?"` and screenshot every 5 s for ~25 s.
  ** Expected `disk <model or vda>`, ~8 lines `read <MB/s>`, ~8 lines `write <MB/s>`, `exit=0`.
  ** Acceptable alternative to record: `Direct disk I/O is not available on /home/prime/.cache/omarchy`, `exit=1`.
  * Type `ls ~/.cache/omarchy/ | grep -c disk-speedtest; ls /dev/shm | grep -c disk-speedtest`; expected `0` and `0` — scratch files removed.
  * Press Super+Space → Trigger → Speed Test → Disk Speed Test; a panel with read/write dials titled with the disk name appears.
  * Screenshot every 3–5 s for 25 s: the read dial moves first, then the write dial, then both settle. Press Escape to close.
  * Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The test needs 2 GB free under `~/.cache`; the 40 GB disk has plenty.
  * Never sleep through the run — the per-second lines are the evidence.
  * Menu pickers may not filter on typing: navigate the Trigger → Speed Test path with arrows and Enter.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the usage refusal with `exit=2`, the streaming `read`/`write` lines with the exit code, the two `0` counts, and the panel during read, during write and settled
  * If unsuccessful
  ** `Disk read test failed before finishing`, leftover `disk-speedtest-*.dat` files, or a panel that never moves
covers: bin/omarchy-disk-speedtest; default/omarchy/omarchy-menu.jsonc:73,101; shell/plugins/panels/disk-speedtest/Panel.qml:99
merged-from: 20:disk-speedtest-cli-and-panel

### reminder-cli-set-show-clear-and-rejects   [VM-OK]
description: `omarchy reminder N 'msg'` sets a reminder from the terminal with a toast and the bar glyph, `show`/`show --json`/`clear` report and remove them, and missing, non-numeric, zero or negative minutes and an unknown `show` argument are refused with usage, creating no timer and no toast.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy reminder 7 'Tea ready'`; toast "Tea ready in 7 minutes"; the bell glyph beside the clock lights.
  * Type `omarchy reminder 3`; toast "Reminder set for 3 minutes".
  * Type `omarchy reminder show`; toast "Upcoming reminders" with two lines. Then `omarchy reminder show --json`; JSON with `"count":2` prints.
  * Unhappy paths: type `omarchy-reminder; echo "exit=$?"`, then `omarchy-reminder abc; echo "exit=$?"`, `omarchy-reminder 0 "Nothing"; echo "exit=$?"`, `omarchy-reminder -5; echo "exit=$?"` and `omarchy-reminder show extra; echo "exit=$?"`; each prints the `Usage:` lines and `exit=1`, no toast.
  ** Wait two seconds after each and confirm no toast appeared before the next. (The router form `omarchy reminder` with no arguments prints synthesized help with `exit=0` instead — that is the router's required-args guard, not the script.)
  * Type `omarchy reminder clear`; toast "All reminders have been cleared"; the glyph goes out. Hover left of the clock: the bell indicator is dimmed.
  * Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Toasts last 5 s; screenshot right after each command.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the two set toasts with the lit glyph, the upcoming toast, the count-2 JSON, the five usage rejections with `exit=1` and no toast, and the cleared toast with the glyph dimmed
  * If unsuccessful
  ** a confirmation toast or a solid bell after a rejected command; screenshot of the terminal output
covers: bin/omarchy-reminder (set/show/clear, usage/validation); manual/09:3
merged-from: 10:reminder-cli-set-show-json-rejects; 30:reminder-cli-rejects-bad-arguments

### menu-cli-summon-toggle-close-and-rejects   [VM-OK]
description: `omarchy menu` drives the shell menu from a terminal — `summon`, `toggle` and `close` at an id or alias (case- and underscore-insensitive), action aliases run directly, `ping` answers — and an unknown verb is refused with a message while an unknown route degrades to the root menu; it is the same surface every menu keybinding uses.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy menu ping` → `ok` (or the plugin's reply), no error. Then `omarchy menu` alone → the root menu opens; press Escape.
  * Type `omarchy menu summon style.theme` → the Theme submenu/picker opens listing the stock themes. Type `omarchy menu close` → it closes.
  * Type `omarchy menu toggle system` → the System menu opens; screenshot; click the terminal and run it again → it closes. Then `omarchy menu summon trigger.capture` → Capture opens; run it again → it stays open; `omarchy menu close` → closed.
  * Aliases: `omarchy menu summon power-menu` → System (`System…`); `omarchy menu summon power` → System; `omarchy menu summon settings` → `Setup…`; `omarchy menu summon SETUP_POWER` → the Setup › Power submenu (case and `_`→`-` normalized); `omarchy menu summon reminder-set` → the reminder overlay opens directly (an alias that names an action runs it). Press Escape after each.
  * Timed close: type `omarchy menu summon root; sleep 3; omarchy menu close` as one line and press Enter → the menu opens and closes by itself about three seconds later.
  * Unhappy path: `omarchy menu bogusverb; echo "exit=$?"` → `omarchy-menu: unknown verb 'bogusverb'. Try 'omarchy menu --help'.`, `exit=2`. Then `omarchy menu summon no.such.route` → expected the root `Go…` menu (record if an empty submenu or nothing opens instead — no crash); `omarchy menu close`; `omarchy menu ping` still answers `ok`.
  * Close the terminal with Super+W; the desktop is as before and the bar is present.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The menu takes focus when it opens; press Escape or click the terminal before typing the next command. Type a whole `summon …; sleep 3; … close` line before Enter — the open menu takes the keyboard.
  * Screenshot within a second of pressing Enter on the summon/close line to catch the menu before it closes.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of `ok`, the root menu, the Theme submenu then closed, System toggled open and closed, Capture via summon then closed via close
  ** Screenshots of `System…` via `power-menu` and `power`, `Setup…` via `settings`, Setup › Power via `SETUP_POWER`, the reminder overlay via `reminder-set`, and the timed open-then-gone pair
  ** Screenshot of the unknown-verb message with `exit=2`, the `no.such.route` result, and `ok` from ping afterwards
  * If unsuccessful
  ** Screenshot of the terminal output of the failing verb, the wrong submenu, or the bar (present or gone); `omarchy-shell shell ping`
covers: bin/omarchy-menu; docs/menu.md §Driving the menu from the CLI; omarchy-menu.jsonc aliases (power-menu, settings, reminder-set); shell/plugins/menu/Menu.qml (openRoute, close); MenuModel.js (resolveRoute); manual/14:62
merged-from: 61:menu-cli-opens-routes; 10:omarchy-menu-cli-summon-toggle-close; 22:menu-cli-verbs-and-routes; 31:menu-cli-routes-and-verbs

### ascii-wordmark-render-skip-and-rejects   [VM-OK]
description: `omarchy ascii` draws text in the Omarchy block font (nine rows per line, from an argument or stdin): letters and spaces draw, characters it cannot draw are named in a `Skipped` line instead of being dropped silently, and undrawable text, unknown options or no input are refused.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and press Super+F so 90 columns fit; type `omarchy ascii Omarchy` — OMARCHY as a 9-row wordmark in `█ ▀ ▄ ▌ ▐` block glyphs; screenshot.
  * Type `omarchy ascii Omarchy | wc -l; printf Omarchy | omarchy ascii | wc -l; printf 'A\n\nB\n' | omarchy ascii | wc -l` → `9`, `9`, `27` — piped input is accepted and a blank line still costs nine rows.
  * Type `omarchy ascii Hi | awk 'NR==1{print length($0)}'; omarchy ascii "H i" | awk 'NR==1{print length($0)}'; omarchy ascii Omarchy | grep -c ' $'` → `18`, `23`, `0` (a space is five columns; no trailing blanks).
  * Type `omarchy ascii "Hi 5"; echo "exit=$?"` → HI drawn, then `Skipped, no glyph in Delta Corps Priest 1: 5` on stderr, `exit=0`. Then `omarchy ascii "Omarchy 4.0" >/dev/null; echo "exit=$?"` → `Skipped, no glyph in Delta Corps Priest 1: 4 . 0`, `exit=0`.
  * Unhappy paths: `omarchy ascii 123; echo "exit=$?"` → no art, `Delta Corps Priest 1 draws letters and spaces only, and that text has neither.`, `exit=1`; `omarchy ascii --bogus; echo "exit=$?"` → `Unknown option: --bogus` + usage, `exit=1`; `omarchy ascii --width 40; echo "exit=$?"` → `Unknown option: --width`, `exit=1`; `omarchy ascii; echo "exit=$?"` → the usage and `exit=1`; `omarchy ascii --help | head -1` → `Usage: omarchy-ascii …`.
  * Type `omarchy ascii -- --help 2>&1 | head -n 10`; the router forwards everything after `--`, so HELP is drawn and `Skipped … : -` printed — no router help.
  * Press Super+F to un-fullscreen, then Super+W to close the terminal.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The art is 9 rows per line of text; a normal terminal shows two words at most and a wrapped line would break the width counts — hence the fullscreen terminal. Clear between steps if needed.
  * `omarchy ascii` and `omarchy-ascii` are the same program.
  * ./client-with-image allows you to get an image back of what you did, so can be useful for speeding things up
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the wordmark; `9 9 27`; `18 23 0`; HI and the two Skipped lines with `exit=0`; each refusal with `exit=1` and the usage line; HELP drawn for the `--` case
  * If unsuccessful
  ** garbled glyphs, an awk error, a hang waiting on stdin, a silently dropped character, an option drawn as art, or wrong counts
covers: bin/omarchy-ascii:1-294; bin/omarchy:129-138 (route `ascii`, `--` forwarding); test/shell.d/ascii-test.sh; manual/41-branding.md
merged-from: 20:ascii-render-and-skip; 51:ascii-wordmark-and-refusals

### dev-add-migration-in-temp-repo   [VM-OK]
description: `omarchy dev add migration --no-edit` scaffolds `migrations/<commit-time>.sh` in the checkout named by `OMARCHY_PATH`; on the packaged install (no git) it fails with git's error, a legacy scope word is accepted with a warning, and unknown flags are refused.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy dev add migration --no-edit; echo "exit=$?"`; expected `fatal: not a git repository …`, non-zero exit (128) — the packaged `/usr/share/omarchy` is not a checkout; `ls /usr/share/omarchy/migrations | tail -1` shows no new file.
  * Type `mkdir /tmp/repo && cd /tmp/repo && git init -q && git -c user.name=qa -c user.email=qa@x commit -q --allow-empty -m init && echo ok`; expected `ok`.
  * Type `OMARCHY_PATH=/tmp/repo omarchy dev add migration --no-edit; echo "exit=$?"`; expected `/tmp/repo/migrations/<10 digits>.sh`, `exit=0`; `ls /tmp/repo/migrations` shows it.
  * Type `OMARCHY_PATH=/tmp/repo omarchy dev add migration user --no-edit 2>&1 | head -n 1`; expected `omarchy-dev-add-migration: migration scopes are no longer used; creating a regular migration.`
  * Unhappy path: type `omarchy dev add migration --bogus; echo "exit=$?"`; expected `Unknown option: --bogus`, `Usage: omarchy-dev-add-migration [--no-edit]`, `exit=1`.
  * Type `cd ~ && rm -rf /tmp/repo` and close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Without `--no-edit` the command opens nvim; if that happens, press Escape then type `:q!` Enter.
  * ./client-with-image allows you to get an image back of what you did, so can be useful for speeding things up
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the git fatal on the packaged path, the created file path with `exit=0` and its `ls`, the scope warning, and the refused flag with `exit=1`
  * If unsuccessful
  ** nvim opening despite `--no-edit`, or a file created under `/usr/share/omarchy/migrations`
covers: bin/omarchy-dev-add-migration
merged-from: 20:dev-add-migration-temp-repo

### agent-usage-update-without-login   [VM-OK] [NET]
description: The agent usage collectors behind the bar's agents widget fail per agent with a clear line when nobody is logged in (no traceback), `--except` skips named agents, and any record they do write is valid JSON.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `ls ~/.local/state/omarchy/agents/usage/ 2>&1`; note which files exist (possibly none).
  * Type `omarchy agent usage-update; echo "exit=$?"`.
  ** Lines like `omarchy-agent-usage-update: claude collector failed` may print; `exit=1` if any collector failed, else `exit=0`. No Python traceback. Collectors probe the network and may take several seconds each.
  * Type `for f in ~/.local/state/omarchy/agents/usage/*.json; do jq -e . "$f" >/dev/null && echo "ok $f"; done` → every existing file prints `ok` (or there are no files).
  * Type `omarchy agent usage-update --except claude codex; echo "exit=$?"` → at most one `codex collector failed` line; no `claude` line.
  * Type `omarchy-agent-usage-claude --help | head -3` → help text mentioning `--force` and `--limits-only`.
  * Type `ls ~/.local/state/omarchy/agents/usage/ 2>&1` again and `rm` any file that was not there in the first step, so the machine is as found. Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Collectors probe the network and may take several seconds each; wait with screenshots, never a long sleep.
  * No agent is logged in on the minted disk, so every collector is expected to fail cleanly — a traceback, not a failure line, is the defect.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Terminal screenshots of the update output with its exit code, the `ok` lines (or empty set), the `--except` run without a `claude` line, and the help text
  * If unsuccessful
  ** Terminal showing a Python traceback, an invalid JSON record, or `--except` still running the excluded collector
covers: bin/omarchy-agent-usage-update; bin/omarchy-agent-usage-{claude,codex,fireworks}
merged-from: 22:agent-usage-update-without-auth

### cli-tab-completion-discoverability   [VM-OK]
description: `omarchy <Tab>` completes command groups, actions and `commands` flags so the CLI is discoverable from the shell, while raw `omarchy-*` binary names stay hidden from first-word completion; a completed-but-wrong route still fails cleanly.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter, type `omarchy ` (with the trailing space) and press Tab twice.
  ** Groups appear, including `theme`, `update`, `refresh`, `toggle`, `install`, `commands`; screenshot before the next keystroke clears the list.
  * Type `theme ` and press Tab twice → actions such as `set`, `list`, `current`, `bg`.
  * Press Ctrl+C, type `omarchy commands --` and press Tab twice → `--all --json --markdown --check`.
  ** `--markdown` (and `--json`) are HEAD-only; a shorter list on 4.0.2 is version skew — record it with `omarchy version`.
  * Press Ctrl+C, type `omarchy-th` and press Tab → nothing completes (the binaries are hidden from word one). Press Ctrl+C.
  * Unhappy path: type `omarchy theme bogus; echo "exit=$?"` and press Enter → `Unknown Omarchy command: omarchy theme bogus` with the `Run 'omarchy commands --all'` pointer and `exit=127` (or a usage message — record which); no crash.
  * Close the terminal with Super+W; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Completion lists print below the prompt; screenshot before the next keystroke clears them. Send Tab as `<TAB>`; a double Tab is two sends.
  * Completions come from `default/bash/completions`, so they need the stock bash prompt — do not run this inside a different shell.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the group list, the theme action list, the `commands` flag list (or the recorded skew), the non-completion of `omarchy-th`, and the bogus-subcommand refusal with its exit code
  * If unsuccessful
  ** Screenshot of `omarchy-*` binaries offered at word one, or no group completion
covers: default/bash/completions; bin/omarchy (route table the completions read)
merged-from: 41:omarchy-tab-completion

### plans-unshipped-commands-absent   [VM-OK]
description: The backup, dots, server and remote-desktop plans are not shipped: their commands do not route, their groups and menu rows do not exist, while the one pre-existing piece — `omarchy install service sunshine` — still resolves with the defects the remote plan lists. A deliberate absence test that flips when a plan lands.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `for r in backup dots server "sunshine pair" "edition server"; do printf '%-16s ' "$r"; omarchy $r 2>&1 | head -1; done` → five lines, each `Unknown Omarchy command: omarchy …`. Then `omarchy backup; echo "exit=$?"` → the Unknown line, the `Run 'omarchy commands --all'` pointer, `exit=127`.
  * Type `omarchy | grep -E '^  (backup|dots|server|sunshine|edition) '` → nothing (no such groups advertised).
  * Type `ls /usr/bin/omarchy-backup* /usr/bin/omarchy-dots* /usr/bin/omarchy-sunshine* 2>&1` → `No such file` for all; `pacman -Q restic 2>&1` → not found.
  * Press Super+Space → Setup: no `Backup` row; Escape. Super+Space → Install → Service: no `Sunshine` row; Escape until closed.
  * Type `omarchy install service sunshine --help` → a Usage naming `omarchy-install-service-sunshine` (the shipped remainder; do not run it). Then `grep -c 'launch_on_start("sunshine")' /usr/bin/omarchy-install-service-sunshine; grep -c ignore-certificate-errors /usr/bin/omarchy-install-service-sunshine` → `1` and `1` — the autostart double-start and the certificate-bypass web app the remote plan calls out are still in place.
  * Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * A pass is every negative holding. If any planned command resolves, report "plan shipped" with its help text rather than a failure.
  * Menu pickers may not filter on typing: walk Setup and Install → Service with the arrows; Escape is two-stage.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the five Unknown lines with `exit=127`, the empty group grep and the missing binaries
  ** Screenshots of Setup and Install › Service without Backup/Sunshine rows
  ** Screenshot of the sunshine help and the two grep counts of `1`
  * If unsuccessful
  ** Screenshot of `omarchy commands --all | grep -E 'backup|dots|server|sunshine'`
covers: plans/backup.md; plans/dots.md; plans/server.md; plans/remote.md §Problem, §Command surface, §Menu; bin/omarchy-install-service-sunshine; bin/omarchy (unknown-route path)
merged-from: 61:plans-unshipped-features-absent

## Not runnable here

None — no block kept in this domain is `VM-NO`.

## Moved to other domains

- 10:theme-set-menu-and-cli-rejects-unknown → E — theme switch from menu and CLI; E's calibration merge `theme-switch-menu-and-hotkey` owns this story.
- 21:theme-switch-cli-rejects-bad-names → E — `omarchy theme set/list/current` and its refusals; same story as above.
- 61:theme-switch-cli-renders-everything → E — theme activation flow and template rendering into the current-theme state.
- 12:background-cli-set-next-reject → E — E has `21:background-next-cli` and `32:background-set-rejects-bad-path`.
- 21:background-set-cli-and-rejects-missing → E — same `theme bg set` story.
- 12:font-cli-current-list-set-reject → E — E has `21:font-list-current-and-set-cli`.
- 51:hermes-theme-hook-without-hermes → E — `omarchy-theme-set-hermes` is a post-theme skin/template step, not a router behaviour.
- 21:refresh-config-cli-guards → E — E has `refresh-config-backs-up-user-file`, `refresh-config-restores-broken-hyprland`, `refresh-tmux-and-hyprsunset`.
- 10:screenshot-cli-modes-and-custom-dir → C — capture modes and the region picker; C has `screenshot-print-region-and-dismiss`, `screenshot-print-keyboard-window-fullscreen`.
- 12:dns-cli-cloudflare-and-back → H — H has `network-dns-pill-change-and-restore`, `network-dns-custom-rejects-empty-input`.
- 12:network-wifi-cli-without-wifi → H — H has `network-wifi-helpers-absent`, `wifi-qr-absent-on-wired`.
- 41:docker-cli-requires-elevation → H — H has `docker-requires-sudo-by-default`, `docker-unreachable-without-elevation`, `sudo-docker-and-keepalive`.
- 13:signing-key-and-repo-sources → H — the security chapter's supply-chain claims (pacman.conf repos, keyring, ISO `.sig`); not a CLI-router story.
- 32:plugin-cli-negative-paths → H — H has `plugin-add-rejects-unsafe-urls`, `plugin-add-local-git-repo-lifecycle`.
- 11:windows-vm-cli-status-key-help → F1 — near-duplicate of F1's `windows-vm-unconfigured-commands`.
- 11:github-cli-lazy-install → F1 — mise-stub lazy install; F1 has `mise-stub-wrapper-install`, `mise-install-wrapper-and-reject`.
- 23:hermes-cli-stub-lifecycle → F1 — install-machinery stub ownership (`omarchy-install-hermes-cli`); F1 owns the mise-stub stories.
- 51:hermes-cli-stub-ownership → F1 — same story as 23:hermes-cli-stub-lifecycle (plus its migration).
- 23:pkg-add-drop-cli-round-trip → F1 — near-duplicate of F1's `pkg-add-drop-cli`.
- 23:install-editor-helix-cli-and-cleanup → F1 — installer/remover pair for an editor.
- 23:dev-env-node-menu-and-cli-round-trip → F1 — Install → Development (mise dev-env), not `omarchy dev`; F1 has `mise-node-offline-bundle` and the `dev-env-*` blocks.
- 23:install-service-sunshine-cli-only → F1 — F1 has `sunshine-service-install-remove`.
- 52:remove-ai-claude-keeps-cli-state → F1 — remover behaviour; F1 has `remove-ai-perplexity-asks-before-user-data`.
- 50:session-desktop-health → A1 — the acceptance session health check (bar, wallpaper, shell ping, failed units, btrfs); A1 owns session stories (`session-locked-probe-via-serial`).
- 60:herdr-cli-help → F2 — herdr is an org app; F2 has seven `herdr-*` blocks.
- 60:omarchy-audio-tuner-no-audio-device → F2 — org-app install and use (NET), not a shipped CLI.
- 12:hooks-battery-low-command → D — D has `24:battery-low-notification-without-battery`, which runs the same hook and checks the same absence paths.
- 51:bar-cli-layout-commands → D — bar layout editing (`put`/`move`/`position`/`transparent`/`defaults`); D is the bar domain (CLI siblings also sit in A1: `bar-position-cli-and-rejects-invalid`, `bar-set-clock-format-move-put-defaults`).
- 51:bar-cli-rejects-bad-input → D — the same command's refusals; keep with the block above.

## Dropped

None.
