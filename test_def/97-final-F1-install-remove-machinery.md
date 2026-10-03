# Install and remove machinery — final tests

This domain covers the Install and Remove menus and their guard convention (installed rows dimmed
with ✓, unselectable and unsearchable; Remove submenus that vanish when nothing is installed), the
`omarchy-pkg-*` helpers and both fuzzy package pickers, the generic `omarchy-install-app` /
`omarchy-install-and-launch` presentation, every `omarchy-install-*` / `omarchy-remove-*` round
trip that fits the ten-minute budget (Vim, Kitty, Firefox, Sublime, VSCode, Emacs from the AUR, Go,
Python+uv, Rust, Ollama, Claude Desktop, 1Password, Signal, Xbox Cloud, Redis container, Voxtype,
Dropbox, Sunshine, the org zsh/fish shells, omasnap through the picker), the launcher's Delete-key
uninstall, mise wrappers, TUI shortcuts, web-app install *machinery* (refusals, escaping, silent
overwrite), the agent-default installer, Windows VM refusals, the security removers on a stock disk,
and the plugin add/update/clone/remove lifecycle. 128 source blocks plus 31 routed in from other
domains (159) → **50 tests** in the main list and **6 recorded as not runnable** (RetroArch,
Heroic/Lutris, GeForce NOW, Hermes Desktop, OpenClaw onboarding, the full Windows VM); **20 blocks
moved** (web-app user story and launch chords → B, sshd hardening and OS-installer provisioning
invariants → H, ISO-only installer paths and the Mac path → I, bar widget put/enable → D, Cliamp and
omareel in use → F2); **3 rerouted** (a fourth Docker-TUI polkit block → B, two first-run
provisioning blocks → H, to join their siblings); **0 dropped**. The routing pass folded 17
incoming blocks into existing tests and added seven: PHP dev-env, Helix, NordVPN, Xbox Controllers
(xpadneo DKMS), the Hermes CLI stub lifecycle, plugin update/rollback from a local origin, and
plugin add over the network (elsewhen, per 03-INTENDED-BEHAVIOUR #24). Notable
merges: seven menu-guard blocks became one catalogue walk (corrected by 01-FACTS: the installed
terminal is **foot**, not Alacritty, and guarded Remove submenus *vanish* rather than render empty);
five plugin-clone blocks became one clone → hot-edit → menu-remove → restore story; five package-
picker blocks became one Install → Package / Remove → Package round trip using `omasnap` so the
install lands in the launcher; four Tailscale blocks became one story that asserts the
03-INTENDED-BEHAVIOUR #13 verdict (the installer waits at `To authenticate, visit:
https://login.tailscale.com/a/…`; Ctrl+C from the menu terminal kills the follow-up; the dimmed
Install row afterwards is a minor defect) instead of reviewers 11/12's expected `Done!` + bar panel.
Three DEFECT verdicts are asserted on the intended side with the observed HEAD behaviour recorded
as the failure: `omarchy-install-gaming-gpu-lib32` must be an exit-0 no-op without a GPU (#1 — the
Steam row is the probe; Heroic/Lutris themselves are not runnable), `omarchy-install-dev-env
<unknown>` must refuse with `Unknown environment: <x>` (#5), and the Docker DB picker's Escape must
be quiet (#6, `main_menu: command not found` today). CODE-INTENDED verdicts folded in: Defaults
menus list uninstalled apps (A1), the Signal/Spotify/1Password chords install immediately (A2),
the Apps-menu Delete key leaves `~/.config` behind (#30), Clone Plugin opens the default editor
(#28); the missing 1Password Remove row is recorded as the #29 sub-defect. Gaps with no source
block in this slice: the behaviour of `Remove → Preinstalls` / `omarchy-install-preinstalls`
(~700 MB) and `omarchy-reinstall-pkgs` — only their menu rows are observed here.

## Tests

### menu-install-dims-installed-remove-hides-uninstalled   [VM-OK]
description: The Install menu is a catalogue that keeps every row visible but dims (✓, unselectable, unsearchable) what is already installed, while the Remove menu hides every submenu with nothing to remove, so on a stock disk Install → Terminal dims Foot and Remove shows exactly five rows; the service probes behind those guards report "not installed". Reviewers 22/31/52 assumed Alacritty was the stock terminal and reviewer 23 expected empty Remove submenus; 01-FACTS settles both (foot is installed; guarded submenus vanish).
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Space → Install. Rows: Package, AUR, AI, Service, Development, Editor, Style, Gaming, Browser, Web App, Terminal, TUI, Windows, Preinstalls; `Preinstalls` is dimmed with a ✓.
  * Open Terminal. Rows Alacritty, Foot, Ghostty, Kitty; `Foot ✓` is dimmed to about 40 % (the installed default), the other three normal.
  ** Press Down and Up through the list: the highlight skips the dimmed row. Move the mouse over it and click: nothing happens, the menu stays open, no installer window appears.
  ** Backspace to Install, type `foot`: no Install → Terminal → Foot row appears (dimmed rows are omitted from search; the Setup › Defaults row or the Foot app may appear). Clear the filter.
  * Open Browser: Chrome, Edge, Brave, Brave Origin, Firefox, Zen — no Chromium row, `Zen` selectable. Back. Open Development → JavaScript: `Node.js` dimmed ✓ (provisioned at install), Bun and Deno selectable. Back twice. Open Service: 1Password, Dropbox, Spotify, Signal, Tailscale, NordVPN, ONCE, Bitwarden, Chromium Account — none dimmed.
  ** `Chromium Account` is not in the manual's service list; report it as present. Never press Enter on an undimmed Install row — they start installers.
  ** Walk the rest of the catalogue, one screenshot each: Editor (7 rows), AI (10), Gaming (10), Development (14, with JavaScript 3 and PHP sub-rows), Style → Font (Cascadia Mono, Meslo LG Mono, Fira Code, Victor Code, Bitstream Vera Mono, Iosevka); `Windows` enabled. Only `Preinstalls`, `Terminal → Foot` and `Development → JavaScript → Node.js` are dimmed ✓. Long submenus scroll — use mouse scroll or type a row name to filter.
  * Backspace to the root and open Remove. Rows exactly: Package, Theme, Web App, TUI, Preinstalls. AI, Services, Development, Gaming, Browser, Windows and Security are absent (their guards hide the whole submenu on a stock disk).
  * Open Remove → Web App: a picker "Select web app to remove…" lists Basecamp, Discord, Google Contacts, Google Maps, Google Messages, Google Photos, HEY, WhatsApp, X, YouTube, Zoom; press Escape. Remove → TUI: picker lists Disk Usage and Docker; Escape. Remove → Theme: a theme picker; Escape. Nothing is removed.
  * At the root type `chrome`: only `Chrome` under Install › Browser appears, no Remove › Browser result. Clear and type `install service`: the Service submenu row is found. Escape until the menu is closed.
  * Open a terminal with Super+Enter and type `omarchy-installed-service-tailscale; echo $?; omarchy-installed-service-dropbox; echo $?` → `1` and `1`; `systemctl is-enabled tailscaled 2>&1` → not found; `omarchy install service` → a help table listing 1password, dropbox, nordvpn, once, signal, spotify, sunshine, tailscale. Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Dimmed rows are drawn at 40 % opacity; compare against neighbouring rows in the screenshot. Move the mouse before hovering: the menu ignores the pointer's resting position when it opens.
  * Escape is two-stage (clears the filter, then closes); Backspace on an empty filter goes back one level.
  * Guards paint from the previous evaluation: if a row looks wrong, close and reopen the menu twice before reporting.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of Install with a dimmed `Preinstalls ✓`; Install → Terminal with a dimmed `Foot ✓` and the cursor resting on a neighbour after Down; the `foot` search without the Install row
  ** Screenshots of Browser (no Chromium, Zen selectable), JavaScript (Node.js dimmed ✓), Service (nine rows, none dimmed), and one per remaining submenu (Editor 7, AI 10, Gaming 10, Development 14, Style → Font 6) with only the three preinstalled rows dimmed
  ** Screenshot of Remove with exactly Package, Theme, Web App, TUI, Preinstalls; the web-app picker; the TUI picker with Disk Usage and Docker
  ** Screenshot of the `chrome` search showing only the Install row; the terminal with `1` `1`, the missing unit and the service help table
  * If unsuccessful
  ** Screenshot of a dimmed row being selectable or activating on click, an installer terminal opening, a Remove submenu present with nothing installed, or a Remove row for absent software
  ** Output of `omarchy-version`
covers: default/omarchy/omarchy-menu.jsonc (install.*, remove.*), shell/plugins/menu/MenuModel.js (isDisabled, labelFor, matchesQuery, isVisible), shell/plugins/menu/Menu.qml (rowSelectable, nextSelectable, disabled row MouseArea), docs/menu.md Guards, test/shell.d/menu-test.sh ("never hides an Install row"), menu-guards-test.sh, pointer-move-gate-test.sh, manual/04-navigation.md, manual/24-commercial-apps-services.md, bin/omarchy (group help), bin/omarchy-webapp-remove, bin/omarchy-tui-remove, bin/omarchy-refresh-applications, bin/omarchy-installed-service-{tailscale,dropbox}, test/shell.d/installed-service-test.sh, omarchy-iso configure_tailscale (absence path), install/omarchy-base.packages
merged-from: 31:menu-install-remove-guards-reflect-installed-software; 22:menu-install-submenu-entries; 52:menu-install-rows-dim-installed-software; 22:menu-remove-submenu-stock; 23:remove-menu-hides-uninstalled-rows; 11:install-service-menu-states; 42:installed-service-checks-absent; 23:install-menu-marks-preinstalled-rows

### pkg-add-drop-present-missing-cli   [VM-OK] [NET]
description: `omarchy pkg add` installs a named package idempotently and fails clearly for one that does not exist, `omarchy pkg drop` removes what is installed and ignores unknown names, and the probe helpers the menu guards rely on (`omarchy-pkg-present/-missing`, `omarchy-cmd-present/-missing`) return the documented exit codes for present, missing and mixed lists.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy pkg add sl; echo rc=$?` → a sudo prompt (`prime`), pacman installs `sl` (a few KB), `rc=0`. Type `sl -h 2>&1 | head -1` → sl's usage line.
  * Type `omarchy pkg add sl; echo rc=$?` → no pacman output (already installed), `rc=0`.
  * Type `omarchy pkg add definitely-not-a-package-xyz; echo rc=$?` → `error: target not found: definitely-not-a-package-xyz`, the red `Error: Package 'definitely-not-a-package-xyz' did not install`, `rc=1`.
  * Probes, one pair per screenshot: `omarchy-pkg-present bash; echo $?` → `0`; `omarchy-pkg-present bash omarchy-not-real; echo $?` → `1`; `omarchy-pkg-missing bash; echo $?` → `1`; `omarchy-pkg-missing bash omarchy-not-real; echo $?` → `0`.
  ** `omarchy-cmd-present bash ls; echo $?` → `0`; `omarchy-cmd-present bash nosuchcmd; echo $?` → `1`; `omarchy-cmd-missing nosuchcmd; echo $?` → `0`; `omarchy-cmd-missing bash; echo $?` → `1`; `omarchy pkg present sl; echo rc=$?` → `rc=0`; `omarchy pkg present sl nothere; echo rc=$?` → `rc=1`.
  * Type `cd /tmp && omarchy-cmd-terminal-cwd; cd ~` → prints `/tmp` (the "open terminal here" helper follows the shell).
  * Type `omarchy pkg drop sl nothere; echo rc=$?` → pacman removes only `sl`, `rc=0`; `omarchy pkg drop sl; echo rc=$?` again → no pacman output, no sudo prompt, `rc=0`; `sl -h 2>&1 | head -1` → `command not found`. Close the terminal with Super+W.
  ** `omarchy-pkg-add` / `omarchy-pkg-drop` are the same commands without the router; `cowsay` (~20 KB, `cowsay hi` draws the cow) is an equally harmless probe package.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The helpers print nothing themselves; only the echoed code is visible. The sudo credential is cached for a few minutes, so later prompts may not appear (passwordless sudo is fine).
  * Exit codes are invisible on a screenshot: every command carries its `; echo rc=$?`. Read the echoed `rc=` lines, not pacman's coloured progress.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of each command with its `rc=` line, especially the red `did not install` error and the idempotent second `add`
  ** Screenshot(s) showing the probe codes `0 1 1 0 0 1 0 1` in that order, `rc=0`/`rc=1` for `pkg present`, and `/tmp`
  ** Screenshot of `drop sl nothere` removing only `sl`, the no-op drop with no sudo prompt, and the final `command not found`
  * If unsuccessful
  ** Screenshot of the deviating output (an `rc=0` after the typo, a sudo prompt on the no-op drop) and `pacman -Q sl`
covers: manual/29-other-packages.md:5,9; bin/omarchy-pkg-add; bin/omarchy-pkg-drop; bin/omarchy-pkg-present; bin/omarchy-pkg-missing; bin/omarchy-cmd-present; bin/omarchy-cmd-missing; bin/omarchy-cmd-terminal-cwd; test/shell.d/pkg-drop-test.sh
merged-from: 11:pkg-add-drop-cli; 23:pkg-missing-present-exit-codes; 23:pkg-add-drop-cli-round-trip

### pkg-install-remove-picker-round-trip   [VM-OK] [NET]
description: Install → Package and Remove → Package are fuzzy pickers: Escape cancels cleanly, choosing an entry installs it after the sudo prompt so it shows in the app launcher, and the red-pointer remover takes it away again; `omasnap` from the omarchy repository is the package so the story ends with a launchable app.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Omarchy Menu with Super+Space, select `Install`, then `Package` using the mouse. A floating terminal opens with an fzf list of repository packages, a preview pane and the footer `alt-p: toggle description, alt-j/k: scroll, tab: multi-select`. Press Escape: it closes and nothing is installed.
  * Menu → Install → Package again; type `omasnap`. The list narrows to `omasnap` and the preview shows `Repository : omarchy` with the "screenshot and annotation overlay" description. Press Enter, type `prime` at the sudo prompt. pacman installs omasnap (5–15 MB), then `● Done! Press any key to close...`. Press a key.
  ** If `omasnap` never appears, open a terminal, run `sudo pacman -Sy`, and retry; if it is still missing use `sl` instead (it has no launcher entry) and report it.
  * Open Apps with Super+Alt+Space and type `Omasnap`: an Omasnap entry is offered. Escape. Open a terminal (Super+Enter) and type `omasnap --version` → a 1.x version.
  * Menu → Remove → Package: an fzf list of installed packages with a red pointer and a `yay -Qi` preview. Press Escape: nothing is removed (`pacman -Q omasnap` in the terminal still lists it).
  * Menu → Remove → Package again; type `omasnap`, make sure the highlighted row is exactly `omasnap`, press Enter. Sudo `prime` if asked; pacman `-Rns` removes it; `Done!`; press a key.
  ** The picker removes whatever is highlighted and Tab marks several rows for one removal — never mark or highlight a system package.
  * In the terminal type `pacman -Q omasnap 2>&1` → `error: package 'omasnap' was not found`. Apps → `Omasnap` → no entry. Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Both pickers are fzf in an `org.omarchy.terminal` floating window: typing filters immediately (click into the terminal first if it does not), Enter confirms, Escape aborts; Alt+P toggles the preview if it hides the list.
  * ./client-with-image after each menu click saves a round trip.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of both pickers, the desktop after each Escape with nothing changed, the filtered `omasnap` row with `Repository : omarchy`, the `Done!` after install and after remove
  ** Screenshot of Omasnap in the Apps menu and of `omasnap --version`, then the `was not found` line and the empty Apps search afterwards
  * If unsuccessful
  ** The picker terminal's `Failed (exit code N)!` text, a pacman signature/sync error, a leftover terminal window, or `pacman -Q omasnap` after the removal
covers: manual/29-other-packages.md:5,9; manual/46:77; default/omarchy/omarchy-menu.jsonc (install.package, remove.package); bin/omarchy-pkg-install; bin/omarchy-pkg-remove; bin/omarchy-pkg-drop; bin/omarchy-pkg-add; bin/omarchy-show-done; omarchy-pkgs/pkgbuilds/omasnap; default/pacman/pacman-stable.conf l.28-29
merged-from: 23:pkg-install-remove-tui-round-trip; 11:install-package-fzf; 11:remove-package-fzf; 13:faq-remove-package-picker; 60:omasnap-install-from-package-menu

### pkg-aur-picker-browse-cancel-and-bogus-name   [VM-OK] [NET]
description: Install → AUR loads the AUR index into the fuzzy picker with a PKGBUILD preview and Escape builds nothing; `omarchy-pkg-aur-accessible` confirms the AUR is reachable and `omarchy-pkg-aur-add` fails clearly for a package that does not exist. A real AUR build is left to the Emacs test.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy-pkg-aur-accessible; echo rc=$?` → `rc=0`; then `yay -Qm | wc -l` and note the count of foreign packages (baseline).
  * Open the Omarchy Menu (Super+Space) → Install → AUR. yay downloads the AUR list (~10 MB, up to 60 s); an fzf list appears with the footer `alt-p: toggle description, alt-b/B: toggle PKGBUILD, alt-j/k: scroll, tab: multi-select`.
  * Type `yay`, arrow to `yay-bin`, press Alt+b: the preview switches to PKGBUILD text; press Alt+Shift+B: back to the package info. Clear the filter and type `omarchy`: AUR entries such as `omarchy-…` appear.
  * Press Escape. The terminal closes without building anything; in your terminal `yay -Qm | wc -l` prints the same count as before.
  * Type `omarchy-pkg-aur-add omarchy-not-a-real-pkg-xyz; echo rc=$?` → yay cannot find it and `rc=1` (or the red `Error: Package ... did not install`); allow up to 30 s. Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Never press Enter on an AUR entry here: an AUR build on 2 vCPUs can exceed the session budget.
  * If the AUR index fetch fails (network), the terminal shows a yay error and closes — screenshot it; that is the report.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** `rc=0` from the accessibility probe; the AUR picker with its footer; the PKGBUILD preview and the info view again; the desktop after Escape with the unchanged `yay -Qm` count; the rejected bogus name with `rc=1`
  * If unsuccessful
  ** yay's network error text, an `rc=0` for the bogus package, or a changed foreign-package count
covers: manual/29-other-packages.md:7; default/omarchy/omarchy-menu.jsonc (install.aur); bin/omarchy-pkg-aur-install; bin/omarchy-pkg-aur-accessible; bin/omarchy-pkg-aur-add
merged-from: 23:pkg-aur-install-tui-and-accessibility; 11:install-aur-browse-and-cancel

### install-app-generic-usage-quoting-and-failure-banner   [VM-OK] [NET]
description: The generic installers behind most menu rows refuse missing arguments, present themselves in an `org.omarchy.terminal` floating window, build their command safely (a quote or semicolon in the display name or package list never runs extra commands), surface a bad package as the red `Failed (exit code 1)` banner rather than a silent close, and launch nothing after a failed install.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter. Type `omarchy-install-app; echo rc=$?` → `Usage: omarchy-install-app <display-name> <packages>`, `rc=1`. Type `omarchy-install-and-launch Foo; echo rc=$?` → `Usage: omarchy-install-and-launch <display-name> <packages> <desktop-id>`, `rc=1`.
  * Type `omarchy-install-app Bogus omarchy-not-a-real-pkg-xyz` → a floating terminal opens: `Installing Bogus...`, sudo `prime`, `error: target not found: omarchy-not-a-real-pkg-xyz`, then the red `● Failed (exit code 1)! Press any key to close...`. Press a key.
  * Type `omarchy-install-and-launch Bogus omarchy-not-a-real-pkg-xyz bogus` → the same red banner and no application window afterwards. Type `omarchy-install-and-launch "Example App" nosuchpackage-zz "Disk Usage"` → `Installing Example App...`, pacman fails, and the Disk Usage TUI does not open.
  * Quoting: type `omarchy-install-app "a'; echo PWNED; echo '" nosuchpackage-zz` → the first line is literally `Installing a'; echo PWNED; echo '...`, pacman fails, and `PWNED` never appears on a line of its own. Type `omarchy-install-app "Example App" "alpha; echo PWNED"` → pacman is asked for `alpha;`, `echo`, `PWNED` as package names (fails); no shell prints `PWNED`.
  * Type `omarchy-install-font "Foo's Font" nosuchpackage-zz "Foo's Family"` → `Installing Foo's Font...`, pacman fails; then `grep -rl "Foo's Family" ~/.config/omarchy 2>/dev/null | wc -l` → `0` (the family was not set).
  * Type `omarchy-launch-floating-terminal-with-presentation 'echo hello; sleep 20'` and, in your terminal, `hyprctl -j clients | jq -r '.[] | select(.class=="org.omarchy.terminal") | .floating'` → `true`; the helper window closes on its own. Close your terminal with Super+W.
  ** `sudo` may ask for `prime` inside the floating terminal; pacman needs the network to say "target not found" — offline it fails earlier, which is still a failed install.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The floating window appears centred over your terminal; screenshot as soon as its first `Installing …` line shows, then again at the red banner before pressing a key.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Both usage lines with `rc=1`; the floating terminal with `target not found` and the red `Failed (exit code 1)!` banner; no window launched after either failed `install-and-launch`
  ** Literal `Installing …` first lines for the quoted names with no standalone `PWNED`; `0` for the font family; `true` for the floating `org.omarchy.terminal` window
  * If unsuccessful
  ** A floating terminal that closed without a banner or printed `Done!` after a failed install, a `PWNED` line, a window launched after a failed install, or a changed font
covers: bin/omarchy-install-app; bin/omarchy-install-and-launch; bin/omarchy-install-font; bin/omarchy-launch-floating-terminal-with-presentation; bin/omarchy-show-done; test/shell.d/desktop-entry-launch-test.sh; test/shell.d/floating-terminal-test.sh
merged-from: 23:install-app-usage-and-failure-banner; 51:install-app-display-name-quoting

### install-editor-vim-set-default-and-uninstall   [VM-OK] [NET]
description: Install → Editor → Vim installs the editor (~10 MB) so it appears in the Apps launcher and dims its Install row, Setup → Defaults → Editor makes it the target of Super+Shift+N, the CLI rejects unknown editors and restores Neovim, and the launcher's Delete key uninstalls Vim so both menus return to stock.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `pacman -Q vim 2>&1; omarchy default editor` → `was not found` and `nvim`. Open the Omarchy Menu (Super+Space) → Install → Editor with the mouse: rows VSCode, Cursor, Zed, Sublime Text, Helix, Vim, Emacs, none dimmed. Click `Vim`.
  ** Floating terminal: `Installing Vim...`, sudo `prime`, pacman installs `vim`, `● Done! Press any key to close...`. Press a key.
  * Menu → Install → Editor again (reopen twice if needed): `Vim` is dimmed with a ✓ and Enter on it does nothing. Escape. Open Apps (Super+Alt+Space), type `vim`: an entry named exactly `Vim` is listed (nvim also matches; ignore it). Escape.
  * Menu → Setup → Defaults → Editor: Neovim carries the ✓. Select Vim → a notification `Vim is now the default editor` (record whether it appears). Press Super+Shift+N: the window that opens is Vim — the classic `VIM - Vi IMproved` splash with `version 9.x` and `by Bram Moolenaar et al.`, no LazyVim dashboard. Type `:q` and Enter.
  * In the terminal type `omarchy default editor` → `vim`; `omarchy default editor bogus` → `Usage: omarchy-default-editor <code|cursor|zed|sublime_text|helix|vim|emacs|nvim>`; `omarchy default editor nvim` → notification `Neovim is now the default editor`. Press Super+Shift+N: Neovim opens (LazyVim dashboard); type `:q!` and Enter.
  * Apps → type `vim`, highlight `Vim`, press Delete → a dialog `Do you want to uninstall Vim?` with an `Uninstall` button. Click `Uninstall` with the mouse.
  ** Floating terminal: `Uninstalling Vim...`, sudo `prime`, pacman removes vim, `Done!`. Press a key.
  * Apps → `vim` → no `Vim` entry. Menu → Install → Editor (twice): `Vim` enabled again. In the terminal `pacman -Q vim 2>&1; omarchy default editor` → `was not found` and `nvim`. Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The uninstall dialog has Cancel and Uninstall; click Uninstall explicitly rather than pressing Enter.
  * `omarchy default editor --install vim` is the CLI form of the same install-then-set path if the menu route is unavailable.
  * ./client-with-image after each menu click saves a round trip.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of Install → Editor before (Vim enabled) and after (dimmed ✓); `Installing Vim...` → `Done!`; `Vim` in Apps
  ** The `Vim is now the default editor` notification (or its absence, noted), Vim's splash opened by Super+Shift+N, `vim` from the CLI, the usage line, Neovim restored by the hotkey
  ** The uninstall dialog, `Uninstalling Vim...` → `Done!`, Apps without Vim, the Install row enabled again, `was not found` and `nvim`
  * If unsuccessful
  ** The floating terminal's `Failed` text, `cat ~/.local/state/omarchy/defaults/editor`, or a launcher/menu state that did not change
covers: manual/18-development-tools.md:5-11; default/omarchy/omarchy-menu.jsonc:165-173,232-238 (install.editor.vim, setup.default.editor); bin/omarchy-default-editor; bin/omarchy-install-app; bin/omarchy-launch-editor; bin/omarchy-remove-launcher-entry; shell/plugins/menu/Menu.qml (Delete-key uninstall); test/shell.d/default-apps-test.sh (missing editor → installer, editor becomes default)
merged-from: 11:install-editor-vim-and-set-default; 23:install-editor-vim-menu-and-launcher-uninstall; 51:default-editor-install-vim-then-cancel

### defaults-missing-app-opens-installer-installed-applies-at-once   [VM-PARTIAL] [NET]
description: Setup → Defaults → Browser / Editor / Terminal list every option whether installed or not (the manual says installed-only; CODE-INTENDED per 03-INTENDED-BEHAVIOUR A1 — the `when` guards were removed on purpose in PR #6950); picking a missing one opens its installer in a floating terminal instead of pointing the default at nothing, aborting keeps the previous default and ✓, and picking an installed one applies at once with no installer. Skipped: letting an install finish (covered by the Vim, Kitty and Firefox tests).
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy default browser; omarchy default editor; omarchy default terminal; tail -1 ~/.config/xdg-terminals.list; pacman -Q alacritty foot ghostty kitty 2>&1` → `chromium`, `nvim`, `foot`, `foot.desktop`, and only `foot` installed.
  * Open the Omarchy Menu (Super+Space) → Setup → Defaults → Browser. Rows: Chromium ✓, Chrome, Brave, Brave Origin, Edge, Firefox, Zen — all selectable although only Chromium is installed. Select Zen: a floating terminal starts `Installing Zen...` (an AUR build). Press Ctrl+C immediately; it closes. Select Firefox: a floating terminal starts installing Firefox; Ctrl+C.
  ** Ctrl+C within the first seconds aborts before anything meaningful downloads; if a sudo prompt appears first, Ctrl+C there.
  * Setup → Defaults → Editor → Vim: installer terminal, Ctrl+C. Setup → Defaults → Terminal: Alacritty, Foot ✓, Ghostty, Kitty all listed and selectable; select Kitty: installer terminal, Ctrl+C.
  * Reopen each of the three Defaults submenus twice: Chromium ✓, Neovim ✓ and Foot ✓ are unchanged, nothing else is marked. In the terminal `omarchy-default-browser; omarchy-default-editor; omarchy-default-terminal` → `chromium`, `nvim`, `foot`; `pacman -Q zen-browser-bin firefox vim kitty 2>&1` → four `was not found` lines.
  * Installed choice applies at once: Setup → Defaults → Browser → Chromium (already the default) → the ✓ stays, no terminal or window opens. In the terminal `omarchy default editor nvim; omarchy default editor` → immediate, `nvim`. Record whether a "… is now the default …" notification appears (reviewer 11 expects one, reviewer 51 none).
  ** Only one terminal is installed on the stock disk, so switching between two installed terminals (✓ moving and `xdg-terminals.list` following) is exercised in the Kitty test.
  * Close the terminal with Super+W; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The floating installer is centred; click into it before pressing Ctrl+C.
  * Use the mouse for the menu selections. Guards paint from the previous evaluation: reopen a submenu twice before asserting a ✓.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the Defaults → Browser list with all seven rows and ✓ on Chromium; the aborted Zen, Firefox, Vim and Kitty installer terminals; the Terminal list with four selectable rows
  ** Screenshots of the three submenus with the ✓ unchanged; the terminal line `chromium nvim foot` and the four not-found lines
  ** Screenshot of Chromium re-selected with nothing opening and `nvim` printed immediately
  * If unsuccessful
  ** A "… is now the default" toast for an app that is not installed, a moved ✓ after an aborted install, an installer terminal for an installed app, or the list differing from the expectation (that would mean the code changed to match the manual — report which)
covers: bin/omarchy-default-browser:40-47; bin/omarchy-default-editor; bin/omarchy-default-terminal:34-41; default/omarchy/omarchy-menu.jsonc:152-164 (setup.default.*); test/shell.d/default-apps-test.sh (installed defaults selected immediately, xdg-terminals.list, failed install preserves default); manual/23-browsers.md:9; manual/15-terminal.md:7
merged-from: 22:default-browser-editor-missing-opens-installer; 11:default-browser-menu-lists-uninstalled; 51:default-apps-installed-selected-immediately

### install-editor-vscode-defaults-and-launcher-uninstall   [VM-OK] [NET]
description: Install → Editor → VSCode installs VS Code (~110 MB) with Omarchy's keyring, no-self-update and theme defaults and opens it; there is no Remove row, so the launcher's Delete key uninstalls it and re-enables the Install row.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Omarchy Menu (Super+Space) → Install → Editor → VSCode.
  ** Floating terminal: `Installing VSCode...`, sudo `prime`, ~110 MB download (1–3 min; screenshot every ≤5 s), theme output, `Done!`. A VS Code window opens within ~20 s in the Omarchy colours; screenshot it and close it with Super+W.
  * Open a terminal (Super+Enter) and type `grep password-store ~/.vscode/argv.json; cat ~/.config/Code/User/settings.json` → `"password-store":"gnome-libsecret"` and `"update.mode": "none"`.
  * Open Apps (Super+Alt+Space), type `code` → `Visual Studio Code` listed. Escape. Menu → Install → Editor (reopen twice): `VSCode` dimmed ✓. Menu → Remove: no Editor row (editors have no remover).
  * Apps → `Visual Studio Code` → press Delete → click `Uninstall` in the `Do you want to uninstall Visual Studio Code?` dialog → floating terminal `Uninstalling Visual Studio Code...`, sudo, `Done!`. Press a key.
  * Apps → `code` → no entry; Menu → Install → Editor → `VSCode` enabled again. In the terminal `ls -d ~/.config/Code 2>&1` → the config directory remains (the launcher uninstall is `pacman -Rns`, which never touches `$HOME` — expected per 03-INTENDED-BEHAVIOUR #30). Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * VS Code's first window may show a welcome tab and a workspace-trust prompt; ignore them. Electron on 2 vCPU may raise Hyprland's "not responding" dialog — click Wait.
  * If the download exceeds the budget, screenshot the progress and report it as SLOW rather than failed.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Install output through `Done!`; the VS Code window in Omarchy colours; both config lines; the launcher entry and the dimmed row; the uninstall dialog and `Uninstalling Visual Studio Code...` → `Done!`; the launcher without it and the Install row enabled
  * If unsuccessful
  ** `Failed` text in the floating terminal, or no window 30 s after `Done!`
covers: bin/omarchy-install-editor-vscode; bin/omarchy-remove-launcher-entry; default/omarchy/omarchy-menu.jsonc (install.editor.vscode); shell/plugins/menu/Menu.qml (Delete-key uninstall)
merged-from: 23:install-editor-vscode-defaults

### install-and-launch-sublime-text-then-uninstall   [VM-OK] [NET]
description: Menu rows built on `omarchy-install-and-launch` install the package and then open the app by themselves; Sublime Text (~20 MB) is the smallest such row, it lands in the Apps launcher and dims its Install row, and the launcher's Delete key removes it again.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Omarchy Menu (Super+Space) → Install → Editor → Sublime Text with the mouse.
  ** Floating terminal: `Installing Sublime Text...`, sudo `prime`, pacman installs `sublime-text-4`, `Done!`. Press a key.
  * Wait up to 10 s: a Sublime Text window opens on its own. Screenshot it, then close it with Super+W.
  ** An "unregistered version" banner inside Sublime is normal. If no window appears within 15 s of `Done!`, that is the failure to report — the launch is part of the row's contract.
  * Open Apps (Super+Alt+Space), type `sublime` → `Sublime Text` listed. Escape. Menu → Install → Editor (reopen twice): `Sublime Text` dimmed ✓.
  * Apps → `sublime` → highlight `Sublime Text` → press Delete → click `Uninstall` in the `Do you want to uninstall Sublime Text?` dialog.
  ** Floating terminal: `Uninstalling Sublime Text...`, sudo, `Done!`. Press a key.
  * Apps → `sublime` → no entry; Menu → Install → Editor → `Sublime Text` enabled again.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The uninstall dialog has Cancel and Uninstall; click Uninstall with the mouse.
  * ./client-with-image after each menu click saves a round trip.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** `Installing Sublime Text...` → `Done!`; the Sublime window that opened by itself; the launcher entry and the dimmed row; the uninstall dialog and `Uninstalling Sublime Text...` → `Done!`; the launcher and menu back to stock
  * If unsuccessful
  ** `Failed (exit code N)!`, or `Done!` with no window 15 s later
covers: bin/omarchy-install-and-launch; bin/omarchy-remove-launcher-entry; default/omarchy/omarchy-menu.jsonc (install.editor.sublime)
merged-from: 23:install-and-launch-sublime-text

### install-editor-emacs-aur-build   [VM-OK] [NET] [SLOW]
description: Install → Editor → Emacs is the one editor row that builds from the AUR (`omarchy-emacs`) and runs a follow-up setup; it must build without stopping on yay prompts, open a themed `emacsclient` frame, land in the launcher and dim its row, and `omarchy-pkg-drop` removes both packages again. This is the slice's only real AUR build.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `pacman -Q emacs omarchy-emacs 2>&1` → both not found. Open the Omarchy Menu (Super+Space) → Install → Editor → Emacs.
  ** Floating terminal: `Installing Emacs...`, yay fetches `omarchy-emacs`, installs `emacs` (~50 MB) and builds the package (sudo `prime` when asked; several minutes on 2 vCPU; screenshot every ≤5 s), then `omarchy-install-emacs` setup output and `Done!`.
  ** If yay asks `Diff to show?` / `Proceed?`, answer `N` / `Y` and report that `--noconfirm` was not honoured.
  * Press a key to close the floating terminal.
  * Within ~30 s an Emacs frame opens (the daemon starts first) in the Omarchy theme colours; screenshot and close it with Super+W.
  * Open Apps (Super+Alt+Space), type `emacs` → an Emacs entry is listed. Escape. Menu → Install → Editor (reopen twice): `Emacs` dimmed ✓.
  * In the terminal type `omarchy-pkg-drop omarchy-emacs emacs` → sudo, pacman removes both. Apps → `emacs` → gone; Menu → Install → Editor → `Emacs` enabled again. Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The AUR build on 2 vCPUs may approach the budget; keep screenshotting rather than waiting silently. If it exceeds the budget, Ctrl+C in the floating terminal and report SLOW with the progress reached.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The AUR build output and `Done!`; the themed Emacs frame; the launcher entry and dimmed row; the cleanup with the entry gone and the row enabled
  * If unsuccessful
  ** yay/makepkg error text, an unanswered yay prompt, or `Done!` with no frame after 60 s
covers: bin/omarchy-install-editor-emacs; bin/omarchy-pkg-aur-add; bin/omarchy-pkg-drop; default/omarchy/omarchy-menu.jsonc (install.editor.emacs)
merged-from: 23:install-editor-emacs-aur

### install-terminal-kitty-switch-and-restore-foot   [VM-OK] [NET]
description: Install → Terminal installs an alternative terminal (Kitty, ~8–15 MB) and repoints Super+Return at it, Setup → Defaults → Terminal switches back to Foot with the ✓ and `xdg-terminals.list` following, the CLI rejects unknown terminals, and — since terminals have no Remove row — the launcher's Delete key uninstalls Kitty so the Install row is enabled again.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `echo $TERM` → `foot`. Type `omarchy-install-terminal wezterm; echo rc=$?` → `Unknown terminal: wezterm`, `rc=1`; `omarchy-install-terminal; echo rc=$?` → the usage line, `rc=1`; `omarchy default terminal bogus` → `Usage: omarchy-default-terminal <alacritty|foot|ghostty|kitty>`.
  * Open the Omarchy Menu (Super+Space) → Install → Terminal: Alacritty, Foot, Ghostty, Kitty with `Foot` dimmed ✓. Click `Kitty`.
  ** Floating terminal with the logo, `Installing kitty...`, sudo `prime`, pacman output, `● Done! Press any key to close...`. Press a key.
  * Press Super+Return: the new window is Kitty (class `kitty`, same Starship prompt; software OpenGL — allow 10 s; if foot opens, wait 3 s and press it once more). Type `echo $TERM` → `xterm-kitty`; `omarchy default terminal` → `kitty`; `cat ~/.config/xdg-terminals.list` → last line `kitty.desktop`. Open Apps (Super+Alt+Space), type `kitty` → a Kitty entry is listed. Escape.
  ** Kitty inherits the system defaults: same font size, padding and theme colours as foot, powerline tab bar at the bottom. In kitty type `kitty @ ls | head -3` → JSON (socket remote control works); `printf '\eP@kitty-cmd{"cmd":"ls"}\e\\'` → no response (remote control via terminal output is rejected).
  * Menu → Install → Terminal (reopen twice): `Kitty` dimmed ✓. Menu → Setup → Defaults → Terminal: Kitty carries the ✓; select Foot → record whether a `Foot is now the default terminal` notification appears. Press Super+Return: a Foot window opens (`echo $TERM` → `foot`; `tail -1 ~/.config/xdg-terminals.list` → `foot.desktop`). Close the Kitty window.
  * Apps → `kitty` → highlight the Kitty entry → press Delete → a `Do you want to uninstall …?` dialog naming Kitty → click `Uninstall` → floating terminal `Uninstalling …`, sudo, `Done!`. Press a key.
  ** Terminals have no Remove counterpart; the launcher Delete key is the only uninstall path and `pacman -Rns` never touches `$HOME`, so `ls -d ~/.config/kitty 2>&1` still lists the directory — expected (03-INTENDED-BEHAVIOUR #30), not a failure.
  * Apps → `kitty` → gone; `pacman -Q kitty 2>&1` → `was not found`; Menu → Install → Terminal → `Kitty` enabled again; Super+Return still opens foot. Close the terminals with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Kitty renders through software OpenGL here; give it 10 s to appear.
  * If the install fails with a network error, screenshot the red `Failed (exit code …)` line and stop.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The two rejections and the usage line; Install → Terminal with `Foot` dimmed ✓; the `Done!` line; a Kitty window with `xterm-kitty`, `kitty` and `kitty.desktop`, looking like foot, the `kitty @ ls` JSON and the ignored escape sequence; Kitty in Apps
  ** The dimmed `Kitty ✓` row; Defaults → Terminal with Kitty ✓ then Foot re-selected (notification or not, noted); the final Foot window with `foot.desktop`
  ** The uninstall dialog, `Done!`, Apps without Kitty, `was not found`, and the Install row enabled again
  * If unsuccessful
  ** The floating terminal's `Failed to install kitty` line, `pacman -Q kitty`, and `cat ~/.config/xdg-terminals.list`
covers: manual/15-terminal.md:5-7; default/omarchy/omarchy-menu.jsonc:160-164,239-242 (install.terminal.*, setup.default.terminal); bin/omarchy-install-terminal; bin/omarchy-default-terminal; bin/omarchy-remove-launcher-entry; config/kitty/kitty.conf; etc/xdg/kitty/kitty.conf; config/alacritty/alacritty.toml; config/ghostty/config; docs/file-layout.md (Kitty defaults); test/shell.d/kitty-config-test.sh
merged-from: 11:install-terminal-kitty-and-switch-default; 23:install-terminal-kitty-and-reject-unknown; 41:terminal-alternatives-kitty-config

### install-browser-firefox-default-policies-and-remove   [VM-OK] [NET]
description: Install → Browser → Firefox installs Firefox (~75 MB) with Omarchy's policies (VAAPI, fractional scaling, overscroll — visible in about:policies) and Wayland setting without promoting it, Setup → Defaults → Browser then makes the browser hotkeys open Firefox and its Private window, `omarchy default browser` reflects it, and Remove → Browser (which never lists Chromium) takes Firefox away again; bad browser names are refused.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy-install-browser opera; echo rc=$?` and `omarchy-remove-browser chromium; echo rc=$?` → each prints its usage line and `rc=1`. Open the Omarchy Menu (Super+Space) → Install → Browser: Chrome, Edge, Brave, Brave Origin, Firefox, Zen, none dimmed. Click `Firefox`.
  ** Floating terminal: `Installing Firefox...`, sudo `prime`, ~75 MB download (1–3 min; screenshot every ≤5 s), then `Firefox browser installed. Make it the default via Setup > Defaults > Browser.` and `Done!`. Press a key.
  * Press Super+Shift+Return: **Chromium** still opens (installing does not promote). Close it. Open Apps (Super+Alt+Space), type `firefox`, Enter: a Firefox window opens (allow 15 s; a welcome tab; not themed by Omarchy — expected).
  * In Firefox open `about:policies`: the Active table lists `Preferences` with `apz.overscroll.enabled`, `media.ffmpeg.vaapi.enabled`, `media.hardware-video-decoding.force-enabled`, `widget.disable-swipe-tracker`, `widget.wayland.fractional-scale.enabled`, each `Status: default`. Open `about:config`, search `widget.wayland.fractional-scale.enabled` → `true`; double-click to toggle to `false` (editable), double-click again to restore. Close Firefox with Super+W.
  * Menu → Setup → Defaults → Browser: Chromium has the ✓. Select Firefox → notification `Firefox is now the default browser`. Press Super+Shift+Return: Firefox opens; press Super+Shift+Alt+B: a Firefox **Private Browsing** window opens. Close both. In the terminal `omarchy default browser` → `firefox`; `cat ~/.config/environment.d/omarchy-firefox-wayland.conf` → `MOZ_ENABLE_WAYLAND=1`.
  * Type `omarchy default browser chromium` → notification `Chromium is now the default browser`. Menu → Install → Browser (reopen twice): `Firefox` dimmed ✓. Menu → Remove → Browser: `Firefox` is listed and Chromium is **not**; click Firefox → floating terminal `Removing Firefox...`, sudo, pacman removes it, `Done!`. Press a key.
  * In the terminal `pacman -Q firefox 2>&1` → `was not found`; `omarchy default browser` → `chromium`. Apps → `firefox` → no entry; Menu → Remove → Browser row hidden again. Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Firefox on 2 vCPU may raise Hyprland's "not responding" dialog while starting — click Wait.
  * `firefox about:policies &` typed in the terminal is an alternative way to reach the policies page.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Both usage rejections; the install completion line and `Done!`; Chromium still opening on the hotkey; Firefox in Apps and its window; about:policies with the five entries and the editable about:config pref
  ** The `Firefox is now the default browser` notification; Firefox and its Private window opened by the hotkeys; `firefox` and `MOZ_ENABLE_WAYLAND=1` from the CLI
  ** The `Chromium is now the default browser` notification; the dimmed row; Remove → Browser listing Firefox without Chromium; `Removing Firefox...` → `Done!`; `was not found`, `chromium`, and the launcher and Remove submenu without Firefox
  * If unsuccessful
  ** The floating terminal's `Failed` text, Firefox not starting (screenshot 15 s after Enter), about:policies showing "No policies", or `xdg-settings get default-web-browser`
covers: manual/23-browsers.md:5-17,31-39; default/omarchy/omarchy-menu.jsonc:152-159,217-222,304-309 (install.browser.firefox, remove.browser.firefox, setup.default.browser); bin/omarchy-install-browser; bin/omarchy-remove-browser; bin/omarchy-default-browser; bin/omarchy-launch-browser; install/helpers/browser-policy.sh; default/firefox/policies.json; test/shell.d/browser-policy-dir-test.sh
merged-from: 11:install-firefox-make-default-and-remove; 23:install-browser-firefox-and-remove; 41:firefox-policies-after-install

### dev-env-go-mise-install-remove-and-unknown-name   [VM-OK] [NET]
description: Install → Development provisions a language through mise (Go, ~70 MB) so its toolchain is on PATH in a new shell, dims the row and makes Remove → Development appear with Go, and removing it takes the toolchain away; Node.js already reads as installed. `omarchy-install-dev-env <unknown>` must refuse with `Unknown environment: <x>` and exit 1 like its remover does; at HEAD it succeeds silently (03-INTENDED-BEHAVIOUR #5, DEFECT) — the proof asserts the refusal and records the silence.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Omarchy Menu (Super+Space) → Install → Development. Rows: Ruby on Rails, Docker DB, JavaScript, Go, PHP, Python, Elixir, Zig, Rust, Java, .NET, OCaml, Clojure, Scala. Open JavaScript: `Node.js` dimmed ✓ (preinstalled), Bun and Deno selectable. Go back.
  * Select Go. A floating terminal shows `Installing Go...` and mise downloading/installing `go@latest` (`mise go@1.x.y ✓ installed`), then `● Done!`. Press a key when done (allow 2 minutes, screenshot every ≤5 s).
  * Press Super+Return (a *new* shell). Type `go version` → `go version go1.x linux/amd64`; `mise ls go` → the installed version.
  * Unknown name: type `omarchy-install-dev-env; echo exit=$?` → the usage line, `exit=1`; `omarchy-install-dev-env cobol; echo exit=$?` → intended `Unknown environment: cobol`, `exit=1`; `omarchy-remove-dev-env cobol; echo exit=$?` → `Unknown environment: cobol`, `exit=1` (correct today).
  ** Observed at HEAD the installer prints nothing and exits 0 for `cobol` — screenshot it and record defect #5. `omarchy install dev-env …` is the same command through the router.
  ** Node.js is provisioned at install (its row is dimmed ✓, `node --version` already works), so the Node.js install → `omarchy-remove-dev-env node` → reinstall round trip is not run here; Go stands in for the mise path.
  * Menu → Install → Development (reopen twice): `Go` dimmed ✓. Menu → Remove → Development is now present and lists Go; select it, wait for `Done!`, press a key.
  * In a new terminal (Super+Return) type `go version` → `command not found` (or mise reporting no version installed). Menu → Remove: the Development row is hidden again. Close the terminals with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Use a *new* terminal after install and after remove so the shell re-evaluates mise shims.
  * If the download fails, screenshot the red `Failed` line and `mise ls | sudo tee /dev/ttyS0` read via get-serial.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of JavaScript → Node.js dimmed ✓; the Go install `Done!`; `go version` and `mise ls go`
  ** Both `cobol` commands refusing with `Unknown environment: cobol` and `exit=1`
  ** Go dimmed ✓ under Install and listed under Remove; the post-removal `command not found` and the hidden Remove → Development row
  * If unsuccessful
  ** The installer silent with `exit=0` for `cobol` (defect #5 present — capture it), or the failed floating terminal and the serial `mise ls` output
covers: manual/18-development-tools.md:13-19; default/omarchy/omarchy-menu.jsonc:263-284,330-350 (install.development.*, remove.development.*, install.development.javascript.node, remove.development.javascript.node); bin/omarchy-install-dev-env (go, node, arg handling); bin/omarchy-remove-dev-env (go, node, unknown); install/user/mise-work.sh; test/shell.d/dev-env-path-test.sh
merged-from: 11:install-dev-env-go; 23:dev-env-node-menu-and-cli-round-trip

### dev-env-python-with-uv-install-and-remove   [VM-OK] [NET]
description: The Python environment installs a mise CPython plus Astral's `uv` through a curl-pipe installer so both are on PATH in a new shell and the Install row dims; its remover deletes both again.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter) and type `uv --version` → `command not found`.
  * Type `omarchy-install-dev-env python` → `Installing Python...`, mise downloads a prebuilt CPython (~40 MB), then `Installing uv...` and the uv installer's `installing to /home/prime/.local/bin`.
  ** The uv installer may mention adding to PATH; `~/.local/bin` is already on PATH in Omarchy.
  * Open a new terminal (Super+Enter): `python --version; uv --version` → `Python 3.1x` and `uv 0.x`.
  * Open the Omarchy Menu (Super+Space) → Install → Development (reopen twice): `Python` dimmed ✓; Remove → Development lists Python. Escape.
  * In the terminal type `omarchy-remove-dev-env python` → `Removing Python...` … `Done!`.
  * New terminal: `uv --version` → `command not found`; `which python` → `/usr/bin/python` or nothing (mise's Python gone). Close the terminals with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * mise and the uv installer print progress on stderr; screenshot every ≤5 s until the prompt returns.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** `command not found` before; the mise and uv installer output; both versions in a new shell; the dimmed row and the Remove row; `Done!`; uv gone and python back to the system one
  * If unsuccessful
  ** The curl or mise error text
covers: bin/omarchy-install-dev-env (python); bin/omarchy-remove-dev-env (python); default/omarchy/omarchy-menu.jsonc (install.development.python, remove.development.python)
merged-from: 23:dev-env-python-with-uv

### dev-env-rust-rustup-install-and-remove   [VM-OK] [NET] [SLOW]
description: The Rust environment installs through rustup's curl-pipe installer rather than mise (~200 MB), dims its row via `~/.rustup`, and Remove → Development → Rust runs `rustup self uninstall` so cargo and `~/.rustup` are gone.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `cargo --version; ls -d ~/.rustup 2>&1` → `command not found` and `No such file`. Open the Omarchy Menu (Super+Space) → Install → Development: `Rust` enabled; select it.
  ** Floating terminal: `Installing Rust...`, rustup downloads the stable toolchain (2–5 min; screenshot every 5 s), `Rust is installed now. Great!`, `Done!`. Press a key.
  * Open a new terminal (Super+Enter) and type `cargo --version` → `cargo 1.x`.
  * Menu → Install → Development (reopen twice): `Rust` dimmed ✓; Menu → Remove → Development is present and lists Rust.
  * Remove → Development → Rust → floating terminal `Removing Rust...` → `Done!`. Press a key.
  * New terminal: `cargo --version; ls -d ~/.rustup 2>&1` → `command not found` and `No such file`. Menu → Install → Development: `Rust` enabled again. Close the terminals with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If the download exceeds the budget, Ctrl+C in the floating terminal and report SLOW with the progress reached.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** rustup's completion line and `Done!`; the cargo version; the dimmed row; the removal; `command not found` and `~/.rustup` gone
  * If unsuccessful
  ** The rustup/curl error text
covers: bin/omarchy-install-dev-env (rust); bin/omarchy-remove-dev-env (rust); default/omarchy/omarchy-menu.jsonc (install.development.rust, remove.development.rust)
merged-from: 23:dev-env-rust-rustup

### mise-install-wrapper-and-name-guard   [VM-OK] [NET]
description: `omarchy-mise-install <package> [command-name [bin-name]]` writes a lazy 4-line wrapper into `~/.local/bin` (the same shape as the preinstalled agent stubs) that installs its tool on first use, and refuses command names that are not plain file names (paths, dotfiles, dashes, control characters) before touching anything; a hostile package name stays quoted data.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy-mise-install; echo rc=$?` → `Usage: omarchy-mise-install <package> [command-name [bin-name]]`, `rc=1`.
  ** Through the router, `omarchy mise install` with no arguments prints the router's help block for the same signature instead.
  * Refusals, each printing `… is not usable as a command name` with `rc=1`: `omarchy-mise-install somepkg ../escape; echo rc=$?`, then the same with `.hidden`, `-dash` and `"$(printf 'with\ttab')"`. Type `touch /tmp/victim; omarchy-mise-install somepkg "../../../..$PWD/../tmp/victim"; ls /tmp/victim` → refused and `/tmp/victim` still exists; `ls ~/.local/escape 2>&1` → No such file.
  * Type `omarchy-mise-install qa-tool; echo rc=$?; cat ~/.local/bin/qa-tool; ls -l ~/.local/bin/qa-tool` → `rc=0`, the body `#!/bin/bash` / `export MISE_MINIMUM_RELEASE_AGE=0` / `mise use -g --quiet "qa-tool" || exit 1` / `exec mise x "qa-tool" -- "qa-tool" "$@"`, and an executable bit. Type `omarchy-mise-install npm:@scope/pkg qa-cmd qa-bin && cat ~/.local/bin/qa-cmd` → `mise use -g --quiet "npm:@scope/pkg"` and `exec mise x "npm:@scope/pkg" -- "qa-bin" "$@"`. Do not run these wrappers.
  * Type `omarchy-mise-install 'npm:pkg$(touch /tmp/PWNED)end' hostile; cat ~/.local/bin/hostile; ls /tmp/PWNED 2>&1` → the package name appears quoted as data and `/tmp/PWNED` does not exist.
  * Real first use: type `omarchy-mise-install npm:figlet figlet && figlet hello` → the first run installs node and the package (~30 MB, up to 2 min) then prints `hello` as ASCII art; `figlet again` is instant. Type `head -4 ~/.local/bin/gh` → the preinstalled stub has the same shape with `"gh"`; `ls ~/.local/bin | tr '\n' ' '` → `claude codex opencode pi gh copilot crush agy grok ghui hunk omp ori` are among the names.
  ** A preinstalled stub behaves the same on first use: `gh --version` → mise downloads gh (~20 MB, progress) then `gh version 2.x`; `gh` → its top-level help (`Work seamlessly with GitHub from the command line.`); `gh auth status` → `You are not logged into any GitHub hosts.`; `gh repo clone nonexistent-org-omarchy-test/nonexistent` → an authentication-required (`To get started with GitHub CLI, please run: gh auth login`) or not-found error, no hang. Do not run `gh auth login`.
  * Clean up: `mise rm -g npm:figlet; mise uninstall --all npm:figlet; mise unuse -g gh; mise uninstall --all gh; rm -f ~/.local/bin/figlet ~/.local/bin/qa-tool ~/.local/bin/qa-cmd ~/.local/bin/hostile /tmp/victim; figlet x` → `command not found`; `cat ~/.local/bin/gh` → still the 4-line stub. Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * mise prints download progress on stderr; wait for the ASCII art before typing further.
  * Never run `qa-tool`, `qa-cmd` or `hostile`: they would call `mise use -g` and go to the network for a package that does not exist.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The usage line with `rc=1`; each refusal with the exact phrase and `rc=1`; `/tmp/victim` intact and no `~/.local/escape`
  ** Both wrapper bodies and the executable bit; the hostile name quoted with `/tmp/PWNED` absent
  ** The ASCII-art `hello`, the instant second run, the `gh` stub head, the stub listing; `gh`'s download + version line, help, auth status and the clone error; the cleanup `command not found` with the `gh` stub intact
  * If unsuccessful
  ** A wrapper written under a refused name or outside `~/.local/bin`, `/tmp/victim` deleted, `/tmp/PWNED` created, a hanging `gh repo clone`, or mise's error text (`mise doctor | head -30 | sudo tee /dev/ttyS0` via get-serial; `mise ls gh`)
covers: manual/17-ai.md:3-22; manual/18-development-tools.md:31-37; bin/omarchy-mise-install; install/user/mise.sh:9; etc/mise/conf.d/omarchy.toml; test/shell.d/mise-install-test.sh; test/shell.d/mise-wrapper-quiet-migration-test.sh
merged-from: 23:mise-install-wrapper-and-name-guard; 20:mise-install-wrapper-and-reject; 11:mise-stub-wrapper-install; 52:mise-install-refuses-bad-command-names; 11:github-cli-lazy-install

### install-docker-db-redis-and-escape-cancels-quietly   [VM-OK] [NET]
description: Install → Development → Docker DB runs a database container with dev-friendly settings (Redis is the smallest, ~40 MB image, bound to 127.0.0.1:6379); cancelling the picker must print only `No databases selected for installation.` and exit 0 — at HEAD an undefined `main_menu` is called first (`main_menu: command not found`; 03-INTENDED-BEHAVIOUR #6, cosmetic DEFECT) which the proof records — and a second install of the same database hits docker's name conflict.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Omarchy Menu (Super+Space) → Install → Development → Docker DB: a floating terminal with the gum picker `Select database (return to install, esc to cancel)` listing MySQL, PostgreSQL, Redis, MongoDB, MariaDB, MSSQL.
  * Press Escape and read the output exactly → intended: only `No databases selected for installation.` then `Done!`; nothing installed. Press a key.
  ** Observed at HEAD: `…/omarchy-install-docker-dbs: line 9: main_menu: command not found` precedes that line — screenshot it and record defect #6.
  * Menu → Install → Development → Docker DB again; arrow to `Redis`, Enter → `Installing Redis...`, sudo `prime`, docker pulls `redis:7` and prints a long container id, `Done!`. Press a key.
  * Open a terminal (Super+Enter) and type `sudo docker ps --format '{{.Names}} {{.Ports}}'` → `redis 127.0.0.1:6379->6379/tcp`; `sudo docker exec redis redis-cli ping` → `PONG`.
  * Type `omarchy-install-docker-dbs Redis` → docker answers `Conflict. The container name "/redis" is already in use` (no duplicate guard; note it).
  * Type `sudo docker rm -f redis` then `sudo docker ps` → the container is gone (empty list). Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Docker's socket is root-only by default in Omarchy (the user is deliberately not in the docker group), hence the sudo prompt inside the floating terminal and `sudo docker` in the terminal.
  * If docker is not running, type `sudo systemctl start docker` and retry once.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The picker; the quiet `No databases selected for installation.` after Escape; `Installing Redis...` with the pull and container id; `docker ps` with the port binding and `PONG`; the conflict error; the empty `docker ps` after cleanup
  * If unsuccessful
  ** The `main_menu: command not found` line after Escape (defect #6 present — capture it), or Docker's daemon/pull error text and `sudo docker ps -a`
covers: bin/omarchy-install-docker-dbs; default/omarchy/omarchy-menu.jsonc:264 (install.development.docker-dbs); bin/omarchy-sudo-docker; manual/18-development-tools.md:29
merged-from: 23:docker-db-redis-install-and-cancel; 11:docker-db-redis

### tui-install-launch-and-remove   [VM-OK]
description: A user turns a terminal command into a launcher entry: `omarchy tui install` (CLI) and the Install → TUI wizard write a `TUI.float`/`TUI.tile` launcher that opens the command in the chosen window style, the wizard refuses empty fields, Remove → TUI offers a picker and removes one with a toast, and `tui remove all` sweeps the user's TUI launchers and says so when none remain.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy tui install "QA Top" btop float utilities-terminal; echo "exit=$?"; cat "$HOME/.local/share/applications/QA Top.desktop"` → `exit=0` and a file with `Name=QA Top`, `Exec=xdg-terminal-exec --app-id=TUI.float -e btop`, `Icon=utilities-terminal`.
  * Press Super+Alt+Space (Apps), type `QA Top`, Enter: a **floating** terminal running btop appears; press `q` to quit it.
  ** If the launcher does not list it yet, type `update-desktop-database ~/.local/share/applications` in the terminal, wait 5 s, retry, and record that it was needed.
  * Press Super+Space → Install → TUI: a floating terminal prints `Let's create a TUI shortcut you can start with the app launcher.` and `Name>`. Press Enter on the empty Name, Enter on the empty `Launch Command>`, pick `float`, Enter on the empty Icon → `You must set app name, app command, and icon URL/name!` then the red `● Failed (exit code 1)! Press any key to close...`. Press a key.
  * Install → TUI again with Name `QA Tile`, Launch Command `top`, style `tile`, Icon `utilities-terminal` → `You can now find QA Tile using the app launcher (SUPER + SPACE)` and the green `Done!`. Type `grep Exec "$HOME/.local/share/applications/QA Tile.desktop"` → `--app-id=TUI.tile -e top`. Apps → `QA Tile` → a tiled terminal running top; `q`.
  * Menu → Remove → TUI: a `Select TUI to remove` picker lists `Disk Usage`, `Docker`, `QA Tile`, `QA Top`; press Escape — both files remain. Remove → TUI again and pick **QA Top only** → toast `TUI removed — QA Top`; Apps → `QA Top` → No matches.
  ** Never pick Disk Usage or Docker: there is no single-item undo.
  * In the terminal type `omarchy tui remove all; echo "exit=$?"` → `Scanning for TUIs in /home/prime/.local/share/applications...`, `Removing TUI: QA Tile`, `TUIs removed successfully.`, `exit=0`.
  ** If `Removing TUI: Disk Usage` or `Docker` also print, run `omarchy-refresh-applications` afterwards to restore them and report it.
  * Type `omarchy tui remove all; echo "exit=$?"; omarchy tui remove; echo "exit=$?"` → `No TUIs found.` / `exit=0`, then `No TUIs to remove.` / `exit=1`. Menu → Remove: report whether the `TUI` row is still present with Disk Usage and Docker (reviewers 11/22 expect it; reviewer 20 expected the row to vanish). Escape; close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * gum input fields accept typed text and Enter; the window-style question is a two-item chooser (Up/Down + Enter). Use an installed icon name, never a URL, to avoid a download.
  * Screenshot right after the remove command to catch the toast. Do not name a test launcher "all" — that route always wins.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the desktop file, btop in a floating window, the empty-field failure, the interactive success message and the tile Exec line, top tiled
  ** The picker (Escape leaving both), the `TUI removed — QA Top` toast and the empty Apps search, the remove-all transcript, the two "none" messages, and the Remove menu's TUI row state
  * If unsuccessful
  ** The launcher not finding `QA Top`, btop opening tiled, the wizard accepting empty fields, a launcher surviving `remove all`, or Disk Usage/Docker swept without restoration
covers: manual/21-tuis.md:49-51; default/omarchy/omarchy-menu.jsonc:214,295 (install.tui, remove.tui); bin/omarchy-tui-install; bin/omarchy-tui-remove; bin/omarchy-tui-remove-all; default/hypr/apps/system.lua (TUI.float); test/shell.d/launcher-remove-test.sh
merged-from: 20:tui-install-launch-and-menu; 20:tui-remove-single-all-and-none; 11:custom-tui-install-and-remove; 22:tui-shortcut-create-launch-remove

### webapp-install-cli-refuses-bad-input-escapes-and-overwrites   [VM-OK]
description: The web-app installer accepts only http(s) URLs without whitespace and names without slashes (refused with exact messages before any icon fetch), escapes `$` and `%` in the URL and a newline in the name so the launcher opens exactly the given address, silently replaces a same-named app, and its remover notifies even for an unknown name. The menu-driven Install/Remove → Web App user story is domain B's.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy-webapp-install Bad "javascript:alert(1)" webapp; echo "exit=$?"` → `Error: web app URL must be http or https.` and a non-zero exit. Repeat with `"file:///etc/passwd"` and `"ext://x"` in place of the URL — the same refusal each time.
  * Type `omarchy-webapp-install Sneak "https://example.com/ --user-agent=INJECT" webapp; echo "exit=$?"` → `Error: web app URL must not contain whitespace.`; `omarchy-webapp-install "http://example.test/oops" "https://example.com" hey; echo "exit=$?"` → `App name cannot contain '/': http://example.test/oops`. Then `ls ~/.local/share/applications/ | grep -iE 'bad|sneak|^http:'` → nothing.
  * Interactive refusal: type `omarchy-webapp-install`, answer `Name>` with `Evil` and `URL>` with `file:///etc/passwd` → the scheme error appears at once, no icon download starts; `ls ~/.local/share/applications/ | grep Evil` → nothing.
  ** The same checks fire on the menu route: Install → Web App with Name `https://evil.example` → `App name cannot contain '/': https://evil.example` then `Failed (exit code 1)!` (instant, before any network); Name `Sneak`, URL `https://example.com --user-agent=x` → the whitespace error and `Failed (exit code 1)!`. Press a key each time; Apps → `sneak` → No matches.
  ** Icon failure writes nothing: `omarchy-webapp-install Probe example.com https://example.invalid/none.png; echo rc=$?` → `Error: Failed to download icon.`, `rc=1`, and `ls ~/.local/share/applications/Probe.desktop` → no such file (the `.invalid` DNS failure is instantaneous).
  ** On the 4.0.2 build the scheme check may be missing — record `omarchy-version` if a refusal does not appear.
  * Escaping: type `omarchy-webapp-install 'Dollar App' 'https://example.com/a$b' webapp && grep '^Exec=' ~/.local/share/applications/'Dollar App.desktop'` → `Exec=omarchy-launch-webapp "https://example.com/a\\$b"` (two backslashes before the dollar — correct desktop-entry escaping). Open Apps (Super+Alt+Space), type `Dollar`, Enter: a browser app window opens whose address/title reads `https://example.com/a$b` (the page need not load). Close it with Super+W.
  * Type `omarchy-webapp-install 'Percent App' 'https://example.com/s?q=a%20b' webapp`, open it the same way → `s?q=a%20b`, not `a0b`; close it. Type `omarchy-webapp-install "$(printf 'Inject\nExec=evil')" 'https://example.com' webapp && grep -c '^Exec=' ~/.local/share/applications/Inject*.desktop` → `1`.
  * Overwrite: type `omarchy-webapp-install "Dup Test" https://one.example basecamp; echo rc=$?` → `rc=0`; again with `https://two.example` → `rc=0` and no warning; `grep Exec ~/.local/share/applications/Dup\ Test.desktop; ls ~/.local/share/applications | grep -c "Dup Test"` → the Exec shows two.example and the count is `1`. Apps → `dup` → one `Dup Test` row with the Basecamp icon. Escape.
  * Clean up: `omarchy-webapp-remove 'Dollar App'; omarchy-webapp-remove 'Percent App'; omarchy-webapp-remove "Dup Test"; rm -f ~/.local/share/applications/Inject*.desktop` → a `Web app removed — …` toast per app. Then `ls ~/.local/share/applications | wc -l` (note the count); `omarchy-webapp-remove "Nope Not Here"; echo rc=$?` → a toast `Web app removed Nope Not Here` still appears and `rc=0` (known false success; record it) while the count is unchanged. Apps → `Dollar` → nothing listed. Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The icon arguments `webapp`/`hey`/`basecamp` are bundled icon names, so no network fetch happens on the command-line path.
  * The launcher may take a second to index a new `.desktop` file; press Escape and reopen if the entry is not there yet. The browser opens in app mode (no tabs); the URL may be shown in the window title — either is fine. Toasts fade after a few seconds; screenshot immediately.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Each exact error line with its non-zero exit, the empty `ls` filter, the interactive `file://` refusal without an icon fetch, the menu-route refusals ending `Failed (exit code 1)!`, and `Error: Failed to download icon.` with no `Probe.desktop`
  ** The `Exec=` line with `\\$b`, `Dollar App` in Apps, the browser at `a$b` and at `s?q=a%20b`, `grep -c` printing `1`
  ** Both `rc=0` lines with the two.example Exec and count `1`, the single launcher row; the removal toasts, the unknown-name toast with `rc=0` and the unchanged file count, and the empty `Dollar` search
  * If unsuccessful
  ** A `Bad`/`Sneak`/`Evil`/`Probe` launcher existing (`cat` it — security-relevant), a nested `http:` directory, a whitespace URL accepted, an app missing from the launcher (GLib rejected the entry), an address with `a0b`, or two `Exec=` lines
  ** Output of `omarchy-version`
covers: bin/omarchy-webapp-install (argv path, normalize_webapp_url, icon_name_from_ref, require_plain_name, require_http_url, download_icon; :14-27,61-84,155-180); bin/omarchy-webapp-remove:60-70; bin/omarchy-launch-webapp; test/shell.d/webapp-install-test.sh; webapp-name-test.sh; webapp-install-escaping-test.sh; manual/25-web-apps.md:3
merged-from: 52:webapp-install-refuses-bad-urls-and-names; 52:webapp-install-launches-with-special-characters; 22:webapp-install-duplicate-name-overwrites; 11:webapp-install-rejects-bad-input; 22:webapp-install-rejects-bad-input

### apps-launcher-delete-key-uninstall-confirm-and-cancel   [VM-OK]
description: Pressing Delete on an app row in the Apps launcher asks `Do you want to uninstall <App>?` with a destructive dialog; every cancel path (Cancel button, Escape, click outside) keeps the app, confirming removes a web app's launcher silently (restored by `omarchy-refresh-applications`), a packaged app hands off to a sudo pacman terminal, and the underlying `omarchy-remove-launcher-entry` rejects missing or unknown arguments.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Alt+Space, type `basecamp`, press Delete → a small dialog over the menu: `Do you want to uninstall Basecamp?` with [Cancel] and a red [Uninstall]. Note which button is pre-selected (reviewers disagree).
  ** Press Left (or Tab) to move to Cancel and Enter: the dialog closes, Basecamp is still listed. Press Delete again, then Escape: still listed. Press Delete again and click the dark area outside the dialog card: still listed.
  * Press Delete once more and click `Uninstall` with the mouse → the menu closes and no floating terminal appears (web apps are removed silently). Reopen Super+Alt+Space, type `basecamp` → No matches. Escape twice.
  * Open a terminal (Super+Enter) and type `omarchy-refresh-applications`, then Super+Alt+Space, `basecamp` → Basecamp is back. Escape.
  * In the terminal type `omarchy-remove-launcher-entry; echo rc=$?` → `Usage: omarchy-remove-launcher-entry <desktop-id> <name>`, `rc=1`; `omarchy-remove-launcher-entry nosuchapp Nope; echo rc=$?` → `Could not find launcher entry: nosuchapp.desktop`, `rc=1`; `omarchy-remove-launcher-entry Basecamp Basecamp; echo rc=$?` → `rc=0` and Apps → `basecamp` → gone; `omarchy-refresh-applications` brings it back again.
  * Packaged app: Super+Alt+Space, type `chrom`, press Delete, choose Uninstall → a floating terminal `Uninstalling Chromium...` asks for a sudo password. Press Ctrl+C: it closes and Chromium stays installed (`pacman -Q chromium` in the terminal).
  * Close the terminal with Super+W; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Delete only does something on app rows (the Apps submenu). If arrow keys do not move the highlight in the dialog, use the mouse.
  * No toast is shown for a launcher-initiated web app removal; the empty search is the proof. If the app row disappears on any cancel path, stop and report it as a destructive failure.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The dialog with both buttons and the pre-selection noted; Basecamp still present after each of the three cancel paths; No matches after Uninstall with no terminal; Basecamp restored after refresh
  ** Both CLI rejections with `rc=1`, Basecamp removed with `rc=0` and restored again; the `Uninstalling Chromium...` sudo prompt aborted with Chromium still installed
  * If unsuccessful
  ** A dialog that did not appear or did not close, the app row gone after a cancel, a floating terminal or sudo prompt for a web app, or Basecamp surviving `Uninstall`
covers: shell/plugins/menu/Menu.qml (requestDeleteSelected, cancelDelete, confirmDelete); shell/Ui/ConfirmDialog.qml; bin/omarchy-remove-launcher-entry; bin/omarchy-webapp-remove; bin/omarchy-refresh-applications; applications/*.desktop; test/shell.d/launcher-remove-test.sh
merged-from: 22:app-launcher-uninstall-with-delete-key; 31:menu-apps-uninstall-confirm-cancel; 23:remove-launcher-entry-webapp-and-errors

### launch-chords-missing-apps-open-installer-abort   [VM-PARTIAL] [NET]
description: The Music, Signal and Passwords chords (Super+Shift+M / G / /) point at apps a stock disk lacks; each opens the floating Omarchy installer terminal naming its app instead of failing silently — the install starts at once and the sudo prompt is the only gate (manual says "offers to install"; CODE-INTENDED per 03-INTENDED-BEHAVIOUR A2) — and Ctrl+C aborts with nothing installed. Skipped: the Spotify install itself (no account, no audio device); 1Password and Signal complete in their own tests.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `pacman -Q 1password signal-desktop spotify 2>&1` → three `was not found` lines.
  * Press Super+Shift+M: a floating terminal titled "Omarchy" (centred, ~875×600, logo on top) starts the Spotify installer (`Installing Spotify...`). Press Ctrl+C at once (at the sudo prompt if it appears first): it closes or returns to a prompt with no `Failed` banner (exit 130 is treated as the user bailing).
  * Press Super+Shift+G: the same floating installer for Signal (`Installing Signal...`). Ctrl+C.
  * Press Super+Shift+/ (Passwords): the installer for 1Password (`Installing 1Password...`). Ctrl+C. In the terminal type `omarchy-launch-1password` → the same installer terminal; Ctrl+C.
  * Type `pacman -Q 1password signal-desktop spotify 2>&1` → still three `was not found` lines; no app window opened. Screenshot the desktop — unchanged.
  * Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Click into the floating terminal before pressing Ctrl+C. Letting an installer run needs minutes of network; abort every time (the installer may fetch package lists before Ctrl+C, hence NET).
  * The floating window is the same `org.omarchy.terminal` presentation used by the Update menu.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of each floating installer terminal naming its app (Spotify, Signal, 1Password, and the CLI-launched 1Password one), the clean exit after each Ctrl+C, and the three `was not found` lines before and after
  * If unsuccessful
  ** Nothing appearing after a chord, an error toast, an installer continuing after Ctrl+C, or a package found afterwards
covers: default/hypr/bindings/applications.lua:14,17,20; bin/omarchy-launch-spotify; bin/omarchy-launch-signal; bin/omarchy-launch-1password; bin/omarchy-install-service-spotify; bin/omarchy-launch-floating-terminal-with-presentation; default/hypr/apps/system.lua:6-11; manual/07:106,108,115; manual/24-commercial-apps-services.md:15-19; test/shell.d/launch-1password-test.sh
merged-from: 22:launch-missing-apps-open-installer; 40:hypr-launch-missing-app-installer-prompt; 51:launch-1password-missing-opens-installer; 11:spotify-hotkey-installs-when-missing

### install-service-1password-hotkey-and-remove   [VM-PARTIAL] [NET]
description: Super+Shift+/ installs 1Password and its CLI when missing (~115–200 MB, 1–4 min; the sudo prompt is the only back-out — CODE-INTENDED per 03-INTENDED-BEHAVIOUR A2), seeds the Chromium extension registration and opens the app; a repeat press focuses it, the Install row dims, there is no Remove row although `omarchy-remove-service-1password` exists (defect #29 sub-item), and that CLI remover undoes all of it. Skipped: signing in and the extension actually loading.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `pacman -Q 1password 2>&1` → not found. Press Super+Shift+/ (Super+Shift+Slash): a floating Omarchy terminal shows `Installing 1Password...` and a sudo prompt — the hotkey installs immediately; type `prime`.
  ** It installs `1password` and `1password-cli` (allow 4 minutes, screenshot every ≤5 s), prints `Installing 1Password extension for Chromium...`, `Opening 1Password...`, `1Password has been installed. Restart Chromium to load the browser extension.` and `Done!`. Press a key.
  * Within ~20 s a 1Password window opens with its welcome / sign-in screen (Electron without GPU acceleration paints slowly). Screenshot it.
  * Press Super+Shift+/ again: the same 1Password window is focused or relaunched — no installer this time. Close it with Super+W.
  * Open Apps (Super+Alt+Space), type `1pass` → `1Password` listed. Escape. Menu (Super+Space) → Install → Service (reopen twice): `1Password` dimmed ✓. Menu → Remove → Services: no 1Password row although the remover exists (03-INTENDED-BEHAVIOUR #29 sub-item, DEFECT: `omarchy-remove-service-1password` is unreachable from the menu — record it).
  * In the terminal type `cat /usr/share/chromium/extensions/aeblfdkhhhdcdjpifhhbdiojplfjncoa.json` → `{ "external_update_url": "https://clients2.google.com/service/update2/crx" }`; `op --version` → a version.
  * Type `omarchy-remove-service-1password` → sudo, pacman removes both packages, `1Password has been removed.` Then Apps → `1pass` → gone; `ls /usr/share/chromium/extensions/aeblfdkhhhdcdjpifhhbdiojplfjncoa.json 2>&1` → `No such file`; Menu → Install → Service → `1Password` enabled again. Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The packages come from Omarchy's own repository, not the AUR. If the download exceeds the budget, screenshot the progress and report SLOW.
  * Skipped here: signing in and the browser extension loading (needs a Chromium restart and Web Store access).
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The installer lines through `Done!`; 1Password's first screen; the repeat chord focusing it with no installer; the launcher entry and dimmed row; the empty Services remove menu
  ** The extension JSON and `op --version`; the remover's `1Password has been removed.`; the entry and file gone and the Install row enabled
  * If unsuccessful
  ** The red `Failed` line and `pacman -Q 1password 1password-cli`, or no window 20 s after `Done!`
covers: manual/24-commercial-apps-services.md:5-9; default/hypr/bindings/applications.lua:20; bin/omarchy-launch-1password; bin/omarchy-install-service-1password; bin/omarchy-remove-service-1password; default/omarchy/omarchy-menu.jsonc (install.service.1password); test/shell.d/launch-1password-test.sh
merged-from: 23:install-service-1password-and-remove; 11:1password-hotkey-installs-when-missing

### install-service-signal-hotkey-and-uninstall   [VM-PARTIAL] [NET] [SLOW]
description: Signal is not preinstalled; Super+Shift+G starts its installer in a floating terminal immediately (the manual's "offers to install" is loose wording — CODE-INTENDED, 03-INTENDED-BEHAVIOUR A2; Ctrl+C at the sudo prompt aborts cleanly), a second run installs it (~150 MB) and launches Signal, repeat presses focus the existing window, the Install row dims, and — with no Remove row — the launcher's Delete key uninstalls it. Skipped: linking a phone.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `pacman -Q signal-desktop 2>&1` → `error: package 'signal-desktop' was not found`.
  * Press Super+Shift+G: a floating Omarchy terminal appears with the logo, `Installing Signal...`, then a sudo password prompt. Press Ctrl+C at the prompt: the terminal closes and nothing is installed (`pacman -Q signal-desktop` still errors).
  * Press Super+Shift+G again; type `prime` at the sudo prompt. pacman downloads signal-desktop (allow up to 4 minutes, screenshot every ≤5 s), then `Opening Signal...`, `Signal has been installed.` and `Done!`. Press a key.
  * A Signal window opens (software rendering; allow 20 s) showing the "Link this device" QR / welcome screen. Press Super+Shift+G once more: focus goes to the same window; in the terminal `hyprctl clients | grep -ci signal` → `1`.
  * Open Apps (Super+Alt+Space), type `signal` → a Signal entry is listed. Escape. Menu (Super+Space) → Install → Service (reopen twice): `Signal` dimmed ✓; Menu → Remove → Services: no Signal row (no remover — gap to note).
  * Close Signal. Apps → `signal` → highlight Signal → press Delete → `Do you want to uninstall Signal?` → click `Uninstall` → floating terminal `Uninstalling Signal...`, sudo, `Done!`. Press a key.
  * Apps → `signal` → gone; `pacman -Q signal-desktop 2>&1` → not found; `ls -d ~/.config/Signal 2>&1` → the config directory remains (expected, #30); Menu → Install → Service → `Signal` enabled again. Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The manual says the hotkey "offers" to install; the code starts the install at once and the sudo prompt is the consent point — CODE-INTENDED (03-INTENDED-BEHAVIOUR A2), the manual is loose.
  * Electron on 2 vCPU may raise Hyprland's "not responding" dialog while Signal starts — click Wait.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The installer terminal, the cancelled attempt with Signal still absent, the completed install lines, Signal's welcome screen, the count `1`, Signal in Apps and the dimmed row
  ** The uninstall dialog, `Uninstalling Signal...` → `Done!`, Apps without Signal, `was not found`, the Install row enabled again
  * If unsuccessful
  ** The red `Failed` line and `pacman -Q signal-desktop`, or a second Signal window after the repeat chord
covers: manual/22-guis.md:68-72; default/hypr/bindings/applications.lua:17; bin/omarchy-launch-signal; bin/omarchy-install-service-signal; bin/omarchy-remove-launcher-entry; default/omarchy/omarchy-menu.jsonc:226 (install.service.signal)
merged-from: 11:signal-hotkey-installs-when-missing

### install-service-tailscale-blocks-at-login-then-remove   [VM-PARTIAL] [NET]
description: With Tailscale absent the Taildrop helpers fail fast (usage line, critical notification, `command not found`) and the probes say "not installed"; Install → Service → Tailscale installs and starts tailscaled but then blocks at `sudo tailscale up` printing `To authenticate, visit: https://login.tailscale.com/a/…` (CODE-INTENDED, 03-INTENDED-BEHAVIOUR #13 — reviewers 11/12 expected `Done!` + a bar panel), and Ctrl+C in the menu's floating terminal kills the whole script so the bar plugin and web app are never added; `tailscale status` then says `Logged out.`, the Install row is dimmed by package presence (minor DEFECT: the menu cannot re-run the setup, only the CLI can), and Remove → Services → Tailscale takes it away. Skipped: joining a tailnet (needs an account), Taildrop, the admin web app.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy-installed-service-tailscale; echo rc=$?` → `rc=1`; `omarchy-tailscale-send; echo rc=$?` → `Usage: omarchy-tailscale-send <machine> [file...]`, `rc=1`; `omarchy-tailscale-send mybox.example.ts.net ~/.bashrc; echo rc=$?` → a red/critical notification `Could not send to mybox` top-right (body mentions `tailscale: command not found`), `rc=1`; `omarchy-tailscale-receive --once; echo rc=$?` → `tailscale: command not found`, `rc=1` within a few seconds (no loop).
  * Open the Omarchy Menu (Super+Space) → Install → Service: `Tailscale` selectable. Select it. Floating terminal: sudo `prime`, pacman installs tailscale (~30 MB), `Installing Tailscale...`, `Starting Tailscale...`, then `To authenticate, visit: https://login.tailscale.com/a/…` and the terminal **waits** at `sudo tailscale up` (no account here). Screenshot the URL.
  ** If the terminal instead reaches `Allowing prime to manage Tailscale...` / `Adding Tailscale to the bar...` / `Done!` without a login, report that the behaviour changed.
  * Press Ctrl+C in the floating terminal: it closes (exit 130) with no `Done!`. The bar shows no Tailscale icon and Apps (Super+Alt+Space) → `tailscale` → no web app entry (the follow-up setup never ran).
  * In the terminal type `systemctl is-active tailscaled` → `active`; `tailscale status; echo rc=$?` → `Logged out.`, `rc=1`; `omarchy-installed-service-tailscale; echo rc=$?` → record the value.
  ** If the floating terminal vanished too fast to read, type `omarchy-install-service-tailscale` in this terminal (`tailscale version` → `command not found` beforehand), Ctrl+C at the login URL, and read the same status; `tailscale status` may need a second after Ctrl+C — repeat once if it errors on the socket. The remaining steps (operator, receive service, bar plugin, web app) do not run — the half-installed state.
  * Menu → Install → Service (reopen twice): `Tailscale` dimmed ✓ — the row is disabled by package presence, so the setup can only be finished from the CLI (record as the minor defect of #13). Menu → Remove → Services is now present and lists Tailscale; select it → floating terminal: `tailscale down`, systemd disables, pacman removes tailscale (sudo), `Tailscale has been removed.`, `Done!`. Press a key.
  * In the terminal `pacman -Q tailscale 2>&1` → `was not found`; `tailscale version 2>&1` → `command not found`; `systemctl is-active tailscaled 2>&1` → inactive / unknown. Menu → Install → Service: `Tailscale` selectable again; Menu → Remove: the Services row hidden again. Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Notifications fade after a few seconds; screenshot right after the command returns. If `--once` has not returned after 30 s, press Ctrl+C and report a hang.
  * Never open the login URL: there is no account to complete it with. If a polkit dialog appears during removal, type `prime`.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Usage + `rc=1`, the critical `Could not send to mybox` notification with `rc=1`, the receive error with `rc=1`, the probe `rc=1`
  ** The floating terminal waiting at `To authenticate, visit: https://login.tailscale.com/a/…` after `Starting Tailscale...`; the terminal closed after Ctrl+C with no `Done!`; the bar without a Tailscale icon and Apps without a Tailscale web app
  ** `active` and `Logged out.` with `rc=1`; the dimmed row (noted as the CLI-only re-run defect) and the Remove row; `Tailscale has been removed.` and `Done!`; `was not found`, `command not found`, inactive, and the menus back to stock
  * If unsuccessful
  ** A hung receive command, a missing notification, the installer's error before the URL, the installer reaching `Done!` without a login (report as changed behaviour), `systemctl status tailscaled | head`, the remover's `Failed` output, or the Remove row missing while the package is installed
covers: manual/24-commercial-apps-services.md:25-29; manual/35-networking.md (Tailscale); manual/51:29; default/omarchy/omarchy-menu.jsonc:227,311 (install.service.tailscale, remove.service.tailscale); bin/omarchy-install-service-tailscale; bin/omarchy-remove-service-tailscale; bin/omarchy-tailscale-send; bin/omarchy-tailscale-receive; bin/omarchy-installed-service-tailscale; bin/omarchy-installed-service-dropbox; test/shell.d/tailscale-test.sh; test/shell.d/tailscale-receive-test.sh
merged-from: 11:tailscale-install-panel; 12:tailscale-install-adds-bar-panel; 13:tailscale-install-service-interactive; 23:tailscale-send-receive-without-tailscale; 23:tailscale-install-without-login

### install-service-dropbox-without-account-and-remove   [VM-PARTIAL] [NET] [SLOW]
description: Install → Service → Dropbox installs the client, enables the bar plugin and starts the daemon (which downloads itself, ~100 MB); without an account only the install output, bar indicator, status probe and Remove → Services → Dropbox are verified.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Omarchy Menu (Super+Space) → Install → Service → Dropbox.
  ** Floating terminal: `Installing all dependencies...`, sudo `prime`, five packages, `Adding Dropbox to the bar...`, `Starting Dropbox...`, `See Dropbox icon behind  hover tray in top right and right-click for setup.`, `Done!`. Press a key.
  * Screenshot every 5 s for up to 3 min while the daemon downloads; a Dropbox indicator appears in the bar's tray area.
  * Open a terminal (Super+Enter) and type `dropbox-cli status; omarchy-installed-service-dropbox; echo rc=$?` → a starting / link-account status and `rc=0`.
  * Menu → Install → Service (reopen twice): `Dropbox` dimmed ✓. Menu → Remove → Services: `Dropbox` listed; click it → floating terminal `Dropbox has been removed.` → `Done!`. Press a key.
  * The bar indicator is gone; in the terminal type `omarchy-installed-service-dropbox; echo rc=$?` → `rc=1`. Menu → Install → Service: `Dropbox` enabled again. Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If the daemon download stalls past 5 min, proceed to removal and mark that step SLOW.
  * Skipped here: linking an account and syncing.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The install output; the bar indicator; `dropbox-cli status` and `rc=0`; the dimmed row and the Remove row; the removal `Done!`; the indicator gone and `rc=1`
  * If unsuccessful
  ** pacman errors, or the indicator/plugin surviving removal
covers: bin/omarchy-install-service-dropbox; bin/omarchy-remove-service-dropbox; bin/omarchy-installed-service-dropbox; default/omarchy/omarchy-menu.jsonc (install.service.dropbox, remove.service.dropbox); test/shell.d/dropbox-test.sh
merged-from: 23:install-service-dropbox-without-account

### install-service-sunshine-and-remove   [VM-PARTIAL] [NET] [SLOW]
description: `omarchy install service sunshine` (no menu row) installs Sunshine (~100 MB), opens the Moonlight firewall ports, enables the user unit, adds the "Sunshine Admin" web app and — still — the autostart line, and opens the admin page with a certificate bypass; `omarchy remove service sunshine` reverses those but keeps `~/.config/sunshine/`. Streaming is skipped (no encoder, no client).
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `sudo ufw status | grep -c omarchy-sunshine` (`prime`) → `0`. Type `omarchy install service sunshine`. Wait for completion with 5-second screenshots: `Installing Sunshine...`, pacman installs sunshine, `Opening Sunshine firewall ports...`, `Installing Sunshine admin web app...`, `Enabling Sunshine autostart...`, the closing `...ports are open for private LANs and Tailscale.` line. Chromium opens on `https://localhost:47990` with a certificate-error bypass — screenshot it and close it with Super+W.
  * Type `pacman -Q sunshine; systemctl --user is-active sunshine; grep -c 'launch_on_start("sunshine")' ~/.config/hypr/autostart.lua` → installed, `active` or `failed` (report the state — the VM has no encoder), `1` (`o.launch_on_start("sunshine")`).
  * Type `sudo ufw status | grep -c omarchy-sunshine` → several rules (`27` expected: the three private ranges; no tailscale0 rules since Tailscale is absent). Press Super+Alt+Space, type `Sunshine` → the "Sunshine Admin" web app row is listed. Escape.
  * Type `omarchy remove service sunshine`; confirm → pacman removes sunshine, `Sunshine has been removed and its Omarchy-managed Moonlight streaming ports have been closed.` Then `pacman -Q sunshine 2>&1; sudo ufw status | grep -c omarchy-sunshine; grep -c 'launch_on_start("sunshine")' ~/.config/hypr/autostart.lua; ls ~/.config/sunshine/` → not found, `0`, `0`, and the config directory still exists (pairing state kept).
  * Apps → `Sunshine` → the web app row is gone. Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * There is no Install → Service → Sunshine row; the CLI is the only path (`omarchy-install-service-sunshine` / `omarchy-remove-service-sunshine` without the router). The installer needs network for pacman; allow several minutes of screenshots. ufw output is long; the `grep -c` counts are what to read.
  * The `--ignore-certificate-errors` web app and the autostart double-start are known plan defects (plans/remote.md); record, do not fail on them.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** `0` before; the installer's step lines; the admin web app with its certificate bypass; the package/unit/autostart line after install; the ufw rule count and the launcher row
  ** After removal: the remover's message, package gone, `0` rules, `0` autostart lines, `~/.config/sunshine/` still present, launcher row gone
  * If unsuccessful
  ** ufw or systemd errors, leftover rules/autostart line after removal, or `journalctl --user -u sunshine -n 50 | sudo tee /dev/ttyS0` read via get-serial
covers: plans/remote.md §Problem (current defects), §Uninstall symmetry; bin/omarchy-install-service-sunshine; bin/omarchy-remove-service-sunshine; manual/26-gaming.md
merged-from: 61:sunshine-service-install-remove; 23:install-service-sunshine-cli-only

### install-chromium-account-and-claude-extension-idempotent   [VM-OK]
description: The Chromium integration installers write config only and are idempotent: Install → Service → Chromium Account adds the Google OAuth flags to `chromium-flags.conf` exactly once and dims its row; `omarchy-install-chromium-claude` seeds the Claude extension into all Chromium-family extension directories through one sudo prompt and is silent when already seeded; the copy-url and yt-dlp native hosts land in the profile the same way. The seeded config stays, so `stop` ends the session.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `grep -c oauth2 ~/.config/chromium-flags.conf` → `0`.
  ** If the file is missing, type `omarchy-install-browser chromium` first (no download; it only writes config) and repeat.
  * Open the Omarchy Menu (Super+Space) → Install → Service: `Chromium Account` is listed and enabled; click it → floating terminal `Installing Chromium Google account support...`, `Now you can login to your Google Account in Chromium.`, `Done!` — no sudo, no network. Press a key.
  * In the terminal `grep oauth2 ~/.config/chromium-flags.conf` → exactly two lines, `--oauth2-client-id=...` and `--oauth2-client-secret=...`. Menu → Install → Service (reopen twice): `Chromium Account` dimmed ✓ and clicking it does nothing. Type `omarchy-install-chromium-google-account; grep -c oauth2 ~/.config/chromium-flags.conf` → the message again, still `2`.
  ** Optionally open Chromium with Super+Shift+Return and click the profile avatar (top right): a Sign in / Turn on sync option is present. Close it with Super+W. Signing in needs a Google account and is not tested.
  * Type `ls /usr/share/chromium/extensions/ 2>&1` → no `fcoeoabgfenejglbffodgkkbkcdhcgfn.json` (or the directory is absent). Type `omarchy-install-chromium-claude; echo rc=$?` → one authentication (a terminal sudo prompt or a centred polkit dialog — type `prime`; screenshot the dialog), then `rc=0`.
  * Type `for b in chromium google-chrome microsoft-edge; do f=/usr/share/$b/extensions/fcoeoabgfenejglbffodgkkbkcdhcgfn.json; stat -c %a $f; jq -r .external_update_url $f; done` → `644` and `https://clients2.google.com/service/update2/crx` three times. Type `omarchy-install-chromium-claude; echo rc=$?` again → no prompt, no output, `rc=0`.
  ** Cancel writes nothing: `sudo rm /usr/share/google-chrome/extensions/fcoeoabgfenejglbffodgkkbkcdhcgfn.json; omarchy-install-chromium-claude; echo rc=$?` → the authentication appears again; click Cancel (or Ctrl+C at the sudo prompt) → non-zero `rc` and `ls` of that file fails. Run `omarchy-install-chromium-claude; echo rc=$?` once more and authenticate → `rc=0`, all three registrations back.
  * Type `omarchy-install-chromium-copy-url && omarchy-install-chromium-ytdlp && ls ~/.config/chromium/NativeMessagingHosts/` → `com.omarchy.copy_url.json` and `com.omarchy.ytdlp.json`. Close the terminal with Super+W; end the session with `stop` (the flags and the seeded extension JSON remain).
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * A password prompt for the Chromium Account row would be unexpected — report it; if the row is hidden, `~/.config/chromium-flags.conf` is missing — report that. The Claude seed authenticates through polkit (a centred Quickshell dialog) or a terminal sudo prompt depending on the build; either is fine once.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** `0` before; the floating terminal's two messages and `Done!`; the two flag lines; the dimmed, inert row; `2` after the repeat (and Chromium's sign-in option if opened)
  ** The absent extension file; one authentication then `rc=0`; `644` + the update URL for all three browser families; the silent second run with `rc=0`; the cancelled re-seed writing nothing with a non-zero `rc`; the re-authenticated run restoring the file; the two native-host files
  * If unsuccessful
  ** A flag count other than 2, the row missing (report whether the flags file exists), the seed's error text, a second run that prompts again, a missing browser family, or a cancelled authentication that still wrote the file
covers: bin/omarchy-install-chromium-google-account; bin/omarchy-install-chromium-claude; bin/omarchy-install-chromium-copy-url; bin/omarchy-install-chromium-ytdlp; default/omarchy/omarchy-menu.jsonc (install.service.chromium-account); manual/46:43; test/shell.d/chromium-claude-test.sh
merged-from: 23:install-chromium-google-account-idempotent; 23:install-chromium-claude-extension-seed; 13:faq-chromium-account-credentials; 51:chromium-claude-extension-pkexec

### install-ai-ollama-cpu-and-remove   [VM-OK] [NET]
description: Install → AI → Ollama picks the plain CPU `ollama` package on a machine without NVIDIA/ROCm tooling (small; reviewer 11 estimated hundreds of MB, 01-FACTS lists it as a small install) and leaves a working `ollama` CLI; Remove → AI → Ollama stops the service and deletes the model directories. Pulling a model is out of budget.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `ollama --version 2>&1` → `command not found`. Open the Omarchy Menu (Super+Space) → Install → AI. Rows include ChatGPT Desktop, Claude Desktop, Dictation, Grok Bot, Hermes Desktop, LM Studio, Ollama, OpenClaw, Perplexity, T3 Code, none dimmed. Screenshot the list. Select Ollama.
  ** Floating terminal: `Installing Ollama...`, sudo `prime`, pacman installs the plain `ollama` package (not `ollama-cuda` / `-rocm`; allow up to 5 minutes, screenshot every ≤5 s), `● Done! Press any key to close...`. Press a key.
  * In the terminal type `ollama --version` → a version line (a warning that the server is not running is acceptable). Do not run `ollama pull`.
  * Menu → Install → AI (reopen twice): `Ollama` dimmed ✓. Menu → Remove → AI is now present and lists Ollama.
  * Remove → AI → Ollama → floating terminal: systemd disable (may say unit not found), pacman removes ollama, `Ollama and its models have been removed.`, `Done!`. Press a key.
  * In the terminal type `ollama --version; ls -d /var/lib/ollama ~/.ollama 2>&1` → `command not found` and both `No such file`. Menu → Remove: the AI row hidden again; Install → AI → `Ollama` enabled. Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Ollama is a CLI/service with no launcher entry; the version line is the visible proof.
  * If pacman fails on the download, screenshot the red `Failed` line and stop; that is the report.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The Install → AI list; `Installing Ollama...` naming the `ollama` package → `Done!`; `ollama --version`; the dimmed row and the Remove row; the removal output; `command not found` and both dirs missing
  * If unsuccessful
  ** A cuda/rocm package being chosen, the failed terminal and `pacman -Q ollama`, or the remover's `Failed` text
covers: manual/17-ai.md:59-61; default/omarchy/omarchy-menu.jsonc:243-252,317 (install.ai.ollama, remove.ai.ollama); bin/omarchy-install-app; bin/omarchy-remove-ai-ollama; test/shell.d/remove-ai-test.sh
merged-from: 23:install-ai-ollama-and-remove; 11:install-ai-ollama-local-llm

### install-ai-claude-desktop-and-remove   [VM-OK] [NET]
description: Install → AI → Claude Desktop installs (~110 MB) and opens the app so it shows in the launcher and dims its row; Remove → AI → Claude Desktop quits it, removes the package and its own config while leaving the Claude Code CLI stub alone.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Omarchy Menu (Super+Space) → Install → AI → Claude Desktop.
  ** Floating terminal: `Installing Claude...`, sudo `prime`, ~110 MB (1–3 min; screenshot every ≤5 s), `Opening Claude...`, `Claude has been installed.`, `Done!`. A Claude login window opens within ~15 s. Screenshot it and leave it running.
  * Open a terminal (Super+Enter) and type `ls -d ~/.config/Claude ~/.local/bin/claude` → both exist (the app's config and the CLI stub). Open Apps (Super+Alt+Space), type `claude` → a `Claude` desktop entry is listed. Escape.
  * Menu → Install → AI (reopen twice): `Claude Desktop` dimmed ✓. Menu → Remove → AI: `Claude Desktop` listed; click it.
  ** Floating terminal: the Claude window disappears (the remover quits it first), pacman removes claude-desktop, `Claude has been removed.`, `Done!`. Press a key.
  * In the terminal type `ls -d ~/.config/Claude ~/.cache/Claude ~/.local/bin/claude 2>&1` → the first two `No such file`, the stub still present.
  * Apps → `claude` → no `Claude` desktop entry; Menu → Install → AI → `Claude Desktop` enabled again. Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Electron on 2 vCPU may raise Hyprland's "not responding" dialog — click Wait. If the app never finished starting and `~/.config/Claude` is absent, continue; the remover must still succeed.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The install output; the Claude window; the two paths present and the launcher entry; the dimmed row and Remove row; the window vanishing and `Claude has been removed.`; config gone, stub kept; launcher and menu back to stock
  * If unsuccessful
  ** `Failed` output, or `~/.config/Claude` surviving with the app still open
covers: bin/omarchy-install-ai-claude; bin/omarchy-remove-ai-claude; default/omarchy/omarchy-menu.jsonc (install.ai.claude, remove.ai.claude); test/shell.d/remove-ai-test.sh
merged-from: 23:install-ai-claude-desktop-and-remove

### remove-ai-perplexity-claude-keep-user-and-cli-state   [VM-OK]
description: The AI removers protect user state when run against seeded stand-in files with no package installed: removing Perplexity deletes the app's runtime and caches but only deletes the user's logins and settings after an explicit Yes (default No, never asked without a terminal), and removing the Claude desktop app deletes only its own config and caches while the Claude Code CLI's state stays, so uninstalling the GUI never logs the CLI out.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and seed stand-in state: `mkdir -p ~/.config/Perplexity ~/.cache/Perplexity ~/.cache/perplexity-rpc-server ~/.local/share/perplexity-rpc-server ~/.local/state/perplexity && touch ~/.config/perplexity-flags.conf`.
  * Type `omarchy-remove-ai-perplexity < /dev/null` (no terminal on stdin) → no question is asked. Type `ls -d ~/.cache/Perplexity ~/.cache/perplexity-rpc-server ~/.local/share/perplexity-rpc-server ~/.config/Perplexity ~/.local/state/perplexity ~/.config/perplexity-flags.conf` → the first three are gone, the last three remain.
  * Re-seed the caches (repeat the first `mkdir` line) and type `omarchy-remove-ai-perplexity` → a confirm prompt about deleting the user's data with **No** preselected. Press Enter. `ls -d ~/.config/Perplexity` still lists it.
  * Type `omarchy-remove-ai-perplexity` again and move to Yes (Left/Right), Enter → `ls -d ~/.config/Perplexity ~/.local/state/perplexity ~/.config/perplexity-flags.conf` → all `No such file`.
  * Claude: seed `mkdir -p ~/.config/Claude ~/.cache/Claude ~/.cache/claude-cli-nodejs ~/.claude && touch ~/.claude.json`, then `omarchy-remove-ai-claude; echo "exit=$?"` → completes (no package, so only files are handled). Type `ls -d ~/.config/Claude ~/.cache/Claude ~/.cache/claude-cli-nodejs ~/.claude ~/.claude.json` → `No such file` for `.config/Claude` and `.cache/Claude`; the other three are listed.
  * Open the Omarchy Menu (Super+Space) → Remove: no AI row (nothing installed). Escape. Clean up the stand-ins: `rm -rf ~/.claude ~/.claude.json ~/.cache/claude-cli-nodejs`; the home directory is back as it was. Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The Perplexity prompt is `gum confirm --default=false`; a bare Enter must keep the data.
  * Neither package is installed, so the removers' `omarchy-pkg-drop` is a no-op and no pacman transaction runs. Do not test the LM Studio home-pointer refusal on this disk: on a build predating the guard it would delete the home directory.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** No prompt with stdin redirected and the kept/deleted split; the prompt with No preselected leaving `.config/Perplexity`; the data deleted only after Yes
  ** The Claude `ls`: the two app directories gone, the three CLI paths present; Remove without an AI row
  * If unsuccessful
  ** A prompt appearing with stdin redirected, `.config/Perplexity` deleted on a bare Enter, caches surviving, or `~/.claude`, `~/.claude.json` or `~/.cache/claude-cli-nodejs` deleted
  ** Output of `omarchy-version`
covers: bin/omarchy-remove-ai-perplexity; bin/omarchy-remove-ai-claude; bin/omarchy-pkg-drop; test/shell.d/remove-ai-test.sh; test/shell.d/pkg-drop-test.sh; manual/17-ai.md
merged-from: 52:remove-ai-perplexity-asks-before-user-data; 52:remove-ai-claude-keeps-cli-state

### default-agent-pick-installs-pi-via-mise-and-abort   [VM-PARTIAL] [NET]
description: No default agent ships: Super+Shift+Ctrl+A opens the Setup → Defaults → Agent submenu with nothing marked and `omarchy agent` exits 1 with a hint; picking an agent that is only a stub opens a floating terminal that installs it through mise (no toast), aborting leaves no default and no ✓, and letting Pi (the smallest) finish makes it the default so the ✓ appears and the chord launches it in `~/Work`. Sign-in cannot be completed in the guest.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `echo "[$(omarchy default agent)]"` → `[]`; `omarchy agent; echo exit=$?` → a hint that no default agent is set, `exit=1`. Press Super+Shift+Ctrl+A: the menu opens at "Default Agent…" with 14 rows and no ✓ — nothing is launched. Escape.
  ** The agents bar widget (robot glyph) is hidden on this VM by design (01-FACTS); if it is present, right-click it → the same Default Agent submenu; left-click → a panel toggles (no usage data, or a prompt to set an agent); click again to close.
  * Open the Omarchy Menu (Super+Space) → Setup → Defaults → Agent → Codex: a floating terminal runs the install through mise (download output), no toast. Press Ctrl+C within 10 s: it closes. In the terminal `echo "[$(omarchy default agent)]"` → still `[]`; reopen the Agent submenu twice → no ✓ on any row.
  * Type `omarchy default agent codex` → the same floating installer opens; Ctrl+C.
  * Menu → Setup → Defaults → Agent → Pi: the floating terminal shows mise installing `pi` (progress lines; ~30 MB, allow 90 s, screenshot every ≤5 s), then the screen clears and Pi's own TUI starts (a provider / API key prompt or its chat input). Screenshot it. Press Ctrl+C (twice if needed): the floating terminal closes.
  ** On failure the terminal shows `Could not install Pi with mise` and a red `Failed` line — screenshot it.
  * In the terminal `omarchy default agent` → `pi`; `ls -la ~/.local/bin/pi` → the stub exists. Menu → Setup → Defaults → Agent (reopen twice): `Pi` carries the ✓. Escape.
  * Press Super+Shift+Ctrl+A: now a terminal window (class `org.omarchy.agent`) opens running Pi directly, started in `~/Work` (Pi's status line or a `pwd` shows `Work`). Ctrl+C to leave; close the window.
  * Restore: `rm ~/.config/omarchy/defaults/agent; echo "[$(omarchy default agent)]"` → `[]`; `mise ls` → find the pi tool it lists and remove it with `mise uninstall --all <that tool>` (report the name). Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The floating terminal is centred; click into it before pressing Ctrl+C. If the Codex install finishes before you abort, Codex launches inline and `[codex]` prints — `rm ~/.config/omarchy/defaults/agent` and note it.
  * Skipped in this guest: authenticating an agent and running a prompt. The first-run "Set your default agent" notification is already consumed on the minted disk.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** `[]` and the `exit=1` hint; the Agent submenu opened by the chord with nothing marked; the Codex install terminal with no toast, `[]` after aborting, no ✓
  ** mise installing Pi, Pi's first screen, `omarchy default agent` printing `pi`, the ✓ on Pi, the agent window opened by the chord in `~/Work`; `[]` after the restore and the mise tool removed
  * If unsuccessful
  ** `Could not install Pi with mise`, a ✓ or a changed default after an aborted install, a toast instead of a terminal, or `mise ls | sudo tee /dev/ttyS0` read via get-serial
covers: manual/17-ai.md:26,33; default/omarchy/omarchy-menu.jsonc:151 (setup.default.agent.*); bin/omarchy-default-agent; bin/omarchy-agent:16-20,128-131 (--pick); install/user/mise.sh; default/hypr/bindings/utilities.lua:97; test/shell.d/default-agent-test.sh; test/shell.d/agents-panel-test.sh
merged-from: 11:default-agent-pick-installs-pi; 22:agent-default-selection-starts-install; 51:default-agent-missing-opens-installer; 22:agent-chord-without-default-opens-picker

### install-ai-dictation-voxtype-without-microphone   [VM-PARTIAL] [NET]
description: With dictation absent the status feed returns the idle JSON, the remover says so, the F9 / Super+Ctrl+X chords are inert and Super+K advertises no dictation row; Install → AI → Dictation offers the ~150 MB install behind a confirm that can be declined, installing starts the user service and bar widget and shows the "Ready" toast, the toggle fails gracefully with no microphone, and Remove → AI → Dictation clears it. Skipped: real dictation (no audio input) and the GPU path.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `command -v voxtype || echo NO-VOXTYPE` → `NO-VOXTYPE`; `omarchy-voxtype-status; echo rc=$?` → `{"alt": "", "class": "idle", "tooltip": ""}` and `rc=0`, returning immediately; `omarchy-voxtype-remove; echo rc=$?` → `Voxtype was not installed.`, `rc=0`.
  * Type `echo ` (no Return), press Super+Ctrl+X, then press and release F9: nothing is typed, no toast, no error. Press Super+K, type `dictation` → no rows; Escape twice. Menu (Super+Space) → Remove: no AI row (Dictation not removable); Install → AI: `Dictation` enabled.
  * Menu → Install → AI → Dictation: a floating terminal asks `Install Voxtype + AI model (~150MB) to enable dictation?` with Yes/No. Choose **No** → it ends without installing (`command -v voxtype` still empty); Install → AI: `Dictation` still enabled.
  * Menu → Install → AI → Dictation → **Yes**: sudo `prime`; pacman installs `wtype voxtype-bin`; the model download shows progress (2–4 min; keep screenshotting); the bar restarts; a toast `Voxtype Dictation Ready — Hold F9 to dictate (or toggle with Super + Ctrl + X).`; `Done!`. Screenshot the bar: a dictation/microphone widget is present.
  * Press Super+Ctrl+X, wait 3 s, screenshot, press Super+Ctrl+X again → an error toast or an error state in the widget (no audio input device), never a crash dialog. In the terminal `journalctl --user -u voxtype.service -n 30 --no-pager | sudo tee /dev/ttyS0` and read the audio/input error lines with get-serial.
  * Menu → Install → AI (reopen twice): `Dictation` dimmed ✓. Menu → Remove → AI → `Dictation` → floating terminal `Uninstall Voxtype to remove dictation.`, pacman removes voxtype-bin, `Done!`.
  * The bar widget is gone; in the terminal `ls ~/.config/voxtype ~/.local/share/voxtype 2>&1` → both `No such file or directory`; Menu → Remove: the AI row hidden again. Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * gum confirm highlights one button: Left/Right or Tab moves between Yes/No, Return picks. Super+Ctrl+X is `<M-C-x>`, F9 is `<F9>`; there is no held-key verb, so push-to-talk itself is untestable — the toggle is the story.
  * If F9 or Super+Ctrl+X produces any toast before the install, that is the bug to report. If the model download stalls past 5 min, Ctrl+C in the floating terminal and report SLOW.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** `NO-VOXTYPE`, the idle JSON with `rc=0`, `Voxtype was not installed.`; the untouched command line after the chords; the empty Super+K filter; the two menu states
  ** The declined confirm with nothing installed; the download and the `Voxtype Dictation Ready` toast; the bar widget; the error state after the toggle; the serial journal lines
  ** The dimmed row; the removal `Done!` with widget and directories gone and the Remove → AI row hidden
  * If unsuccessful
  ** Anything typed by the chords, an install starting without confirmation, a crash dialog, a hung installer, or `~/.config/voxtype` surviving removal
covers: manual/07:153-154; manual/11:13-15; default/hypr/bindings/voxtype.lua; default/hypr/helpers.lua:37-54; default/omarchy/omarchy-menu.jsonc:245,314 (install.ai.dictation, remove.ai.dictation); bin/omarchy-voxtype-install; bin/omarchy-voxtype-remove; bin/omarchy-voxtype-status; default/voxtype/config.toml; test/shell.d/voxtype-invitation-test.sh; test/shell.d/hyprland-default-config-test.sh:147-177
merged-from: 23:voxtype-install-without-microphone; 10:dictation-absent-and-install-prompt; 23:voxtype-absent-paths; 40:hypr-ai-chords-agent-picker-and-dictation-absent

### voxtype-invitation-hook-runs-once   [VM-OK]
description: The one-time dictation invitation sends exactly one clickable notification offering the Voxtype install, records completion in a done marker, and never repeats even though its hook stays installed.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `ls ~/.local/state/omarchy/done/voxtype-install-invitation ~/.config/omarchy/hooks/post-update.d/install-voxtype.hook 2>&1` → on a minted disk the done marker and the hook both exist.
  ** If the hook is under `/usr/share/omarchy/install/user/first-run/install-voxtype.hook` instead, use that path below.
  * Type `bash ~/.config/omarchy/hooks/post-update.d/install-voxtype.hook` → NO notification appears (already done).
  * Type `rm ~/.local/state/omarchy/done/voxtype-install-invitation` then run the hook again → exactly one toast inviting to install Voxtype/dictation appears, and `ls ~/.local/state/omarchy/done/voxtype-install-invitation` shows the marker recreated.
  * Run the hook a third time → no new toast.
  * Optionally click the toast while it is visible: a floating terminal runs `omarchy-voxtype-install`; Ctrl+C at its confirm to abort. Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Toasts fade after a few seconds; screenshot immediately after each hook run.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** No toast with the marker present; exactly one toast after removing the marker with the marker recreated; no toast on the third run
  * If unsuccessful
  ** A repeated toast, no toast after the marker was removed, or the hook deleting itself
  ** Output of `omarchy-version`
covers: install/user/first-run/install-voxtype.hook; bin/omarchy-notification-send; bin/omarchy-voxtype-install; test/shell.d/voxtype-invitation-test.sh; manual/11-text-extraction-dictation.md
merged-from: 52:voxtype-invitation-runs-once

### install-gaming-xbox-cloud-webapp-and-remove   [VM-OK] [NET]
description: Install → Gaming → Xbox Cloud Gaming is the cheapest end-to-end gaming installer: it creates the Xbox web app (icon fetched from the CDN, no sudo), opens it in the browser, appears in the launcher with its icon and dims the row; Remove → Gaming → Xbox Cloud Gaming deletes it and the Gaming remove row hides again.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Omarchy Menu (Super+Space) → Install → Gaming. Rows: Steam, RetroArch, Minecraft, NVIDIA GeForce NOW, Xbox Cloud Gaming, Xbox Controllers, Battle.net, Lutris, Heroic (Epic Games), RetroArch Game Launcher; none dimmed. Screenshot. Menu → Remove: no Gaming row.
  * Install → Gaming → Xbox Cloud Gaming: floating terminal `Installing Xbox Cloud Gaming...`, the icon is fetched, then `Done!` (no sudo), and a frameless Chromium window opens on `xbox.com/en-US/play` (a sign-in / Game Pass landing is fine). Press a key in the terminal; close the window with Super+W.
  ** If the icon download from cdn.jsdelivr.net fails the installer prints `Error: Failed to download icon.` and a red `Failed` line — screenshot and report.
  * Open Apps (Super+Alt+Space), type `Xbox` → `Xbox Cloud Gaming` with an Xbox icon (a generic icon means the fetch failed — report it). Escape. Menu → Install → Gaming (reopen twice): `Xbox Cloud Gaming` dimmed ✓; Menu → Remove → Gaming now present and lists it.
  * Remove → Gaming → Xbox Cloud Gaming → floating terminal removes the web app → `Done!`; press a key.
  * Apps → `Xbox` → no entry; open a terminal (Super+Enter) and type `ls ~/.local/share/applications/ | grep -c Xbox` → `0`. Menu → Remove: no Gaming row; Install → Gaming → `Xbox Cloud Gaming` enabled again. Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The Xbox window is a Chromium app window; Chromium on 2 vCPU may raise Hyprland's "not responding" dialog — click Wait.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The Gaming menus before; the install terminal and the Xbox window; the launcher row with icon; the dimmed row and the Remove row; the removal `Done!`; the launcher row gone and `0`
  * If unsuccessful
  ** The floating terminal's error, or the entry surviving removal
covers: manual/26-gaming.md:7,35-41; default/omarchy/omarchy-menu.jsonc:253-262,325 (install.gaming.xbox-cloud, remove.gaming.xbox-cloud); bin/omarchy-install-gaming-xbox-cloud; bin/omarchy-remove-gaming-xbox-cloud; bin/omarchy-webapp-install
merged-from: 11:install-xbox-cloud-gaming-webapp; 23:gaming-xbox-cloud-webapp-install-remove

### gaming-launchers-refuse-without-install   [VM-OK]
description: The gaming launchers that need an install first refuse cleanly instead of doing nothing: `omarchy launch battlenet` says Battle.net is not installed (exit 1), rejects unknown flags and prints help, and Install → Gaming → RetroArch Game Launcher reports there are no cores instead of showing an empty picker while its command validates game and core paths; no launcher entries are created.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy launch battlenet; echo rc=$?` → `Battle.net is not installed. Run omarchy-install-gaming-battlenet first.` and `rc=1`.
  * Type `omarchy launch battlenet --bogus; echo rc=$?` → `Unknown argument: --bogus`, `Try: omarchy-launch-battlenet --help`, `rc=1`. Type `omarchy launch battlenet --help` → the usage block mentioning `--with-mangohud`.
  * Open the Omarchy Menu (Super+Space) → Install → Gaming: the `Battle.net` row is enabled (not dimmed); Menu → Remove: no Gaming row. Open Apps (Super+Alt+Space), type `Battle` → no Battle.net launcher row (it is created by the installer). Escape.
  * Menu → Install → Gaming → RetroArch Game Launcher → a notification `No RetroArch cores found — /usr/lib/libretro`; no picker opens.
  * In the terminal type `omarchy-games-retro-install snes9x; echo rc=$?` → `Usage: omarchy-games-retro-install [core path-to-game]` and an example, `rc=1`; `omarchy-games-retro-install snes9x /tmp/nogame.sfc; echo rc=$?` → `Game not found: /tmp/nogame.sfc`, `rc=1`; `touch /tmp/game.sfc; omarchy-games-retro-install snes9x /tmp/game.sfc; echo rc=$?` → `Core not found: /usr/lib/libretro/snes9x_libretro.so`, `rc=1`; `rm /tmp/game.sfc`.
  ** `omarchy games retro install …` is the same command through the router.
  * Apps → `game` → no new launcher row; `ls ~/Games 2>&1` → no such directory (created only by the RetroArch installer); `ls ~/.local/share/applications | grep -ci game` → `0`. Escape; close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * No network is needed; nothing is downloaded. The "no cores" notification is brief — screenshot right after selecting the row.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The three Battle.net messages with their `rc` values; the enabled Install row, the absent Remove → Gaming row and the empty `Battle` search
  ** The `No RetroArch cores found` notification (game-controller glyph); the three retro-install errors with `rc=1`; the empty `game` search, the missing `~/Games` and the `0`
  * If unsuccessful
  ** A hang or umu-run starting despite the missing install, an empty core picker, or a launcher created without a core (`ls ~/.local/share/applications`)
covers: manual/26-gaming.md:31,69-73; bin/omarchy-launch-battlenet; default/applications/battlenet.desktop; default/omarchy/omarchy-menu.jsonc:262 (install.gaming.battlenet, remove.gaming.battlenet, install.gaming.retro-launcher); bin/omarchy-games-retro-cores; bin/omarchy-games-retro-install; test/shell.d/battlenet-test.sh
merged-from: 22:launch-battlenet-not-installed; 11:battlenet-launch-without-install; 22:games-retro-install-without-cores; 11:retro-game-launcher-without-cores

### gaming-gpu-lib32-without-gpu-and-steam-install-remove   [VM-PARTIAL] [NET] [SLOW]
description: `omarchy-install-gaming-gpu-lib32` is meant to be a no-op (exit 0) when no Intel/AMD/NVIDIA GPU is detected, so Install → Gaming → Steam continues to install Steam (~300 MB), starts it, shows it in the launcher, dims its row and Remove → Gaming → Steam wipes it; at HEAD the helper leaks exit 1 from its `&&` tail and Steam (like Heroic, Lutris, Battle.net, all under `set -e`) ends `Failed (exit code 1)` on virtio-vga — 03-INTENDED-BEHAVIOUR #1 rules this a DEFECT, so the proof asserts the no-op and records the abort. Skipped: signing in, Proton, running a game.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `lspci | grep -iE 'VGA|Display'` → a virtio/QXL/bochs adapter, no Intel/AMD/NVIDIA. Type `omarchy-install-gaming-gpu-lib32; echo exit=$?` → `Installing lib32 graphics drivers...`, no sudo prompt, no pacman transaction, then intended `exit=0` (no GPU → nothing to do); `pacman -Q steam 2>&1` → not found.
  ** Observed at HEAD: `exit=1`. Screenshot it, record it as defect #1, and continue. Confirm nothing was installed: `omarchy-pkg-present lib32-vulkan-intel lib32-vulkan-radeon lib32-nvidia-utils; echo $?` → `1`; `omarchy-hw-nvidia-gsp; echo $?; omarchy-hw-nvidia-without-gsp; echo $?` → `1` and `1`.
  * Open the Omarchy Menu (Super+Space) → Install → Gaming → Steam: floating terminal `Installing Steam...`, sudo `prime`; pacman may ask which `lib32` provider to use — accept the default; ~300 MB incl. lib32 packages (allow 5 minutes, screenshot every ≤5 s), then `Steam will start automatically now. This might take a while...` and `Done!`. Press a key.
  ** At HEAD the terminal instead ends `● Failed (exit code 1)! Press any key to close...` before that line (the helper under `set -e`). Screenshot the lines above the banner, press a key, record defect #1 and skip to the final check step.
  * Wait for Steam (10–60 s with no feedback, as the manual warns): a floating "Steam" window (1100×700, centred) appears — its self-update/bootstrap dialog or the login window. Screenshot it; do not sign in; close Steam with Super+W (confirm if asked).
  ** If the window has not appeared after 3 minutes, screenshot and report "bootstrap did not finish" — a note, not a failure of the installer.
  * Open Apps (Super+Alt+Space), type `steam` → `Steam` listed. Escape. Menu → Install → Gaming (reopen twice): `Steam` dimmed ✓; Menu → Remove → Gaming lists Steam.
  * Remove → Gaming → Steam → sudo → `Steam and its data have been removed.` → `Done!`. In the terminal `ls -d ~/.steam ~/.local/share/Steam 2>&1` → both `No such file`.
  * Final check: `pacman -Q steam 2>&1` → not found; Apps → `steam` → no entry; Menu → Install → Gaming → `Steam` enabled; Menu → Remove: no Gaming row. Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The helper alone downloads nothing. Steam's own runtime download (~500 MB) happens after launch; never wait for it to finish.
  * Heroic, Lutris and Battle.net call the same helper; their full installs are recorded as not runnable here.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The lspci line; `exit=0` from the helper with no sudo prompt or pacman transaction, `1` from pkg-present and the two hw probes; `Installing Steam...` through `Steam will start automatically now...` and `Done!`; the Steam window; the launcher entry and dimmed row; `Steam and its data have been removed.` with both directories missing; the final stock state
  * If unsuccessful
  ** `exit=1` from the helper and/or the red `Failed (exit code 1)!` banner with the lines above it (defect #1 present — also capture `pacman -Q steam`), a sudo prompt or pacman transaction from the helper, a Steam window never appearing after `Done!`, or Steam surviving the removal
covers: manual/26-gaming.md:11-17; default/omarchy/omarchy-menu.jsonc:253,321 (install.gaming.steam, remove.gaming.steam); bin/omarchy-install-gaming-steam; bin/omarchy-remove-gaming-steam; bin/omarchy-install-gaming-gpu-lib32 (and omarchy-install-gaming-heroic/lutris/battlenet by dependency); bin/omarchy-hw-nvidia-gsp; bin/omarchy-hw-nvidia-without-gsp; default/hypr/apps/steam.lua
merged-from: 23:install-gaming-steam; 11:install-steam; 23:gaming-gpu-lib32-no-gpu-exit-status

### windows-vm-install-refused-and-unconfigured-commands   [VM-PARTIAL]
description: Before a Windows VM exists every `omarchy-windows-vm` subcommand says so and exits 1, help and unknown commands behave, removal can be declined and `omarchy-windows-key` finds no firmware key; Install → Windows stops at the prerequisite check on this 40 GB / no-nested-KVM guest with a boxed `❌ KVM virtualization not available!` or `❌ Insufficient disk space!` message and installs nothing — though it creates `~/.windows` and `~/Windows` before checking (recorded). Skipped: the real install (≥ 74 GB free, nested KVM, multi-GB download).
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy-windows-vm status; echo rc=$?` → `Windows VM not configured.` / `To set up: omarchy-windows-vm install`, `rc=1`; `omarchy-windows-vm launch; echo rc=$?` and `omarchy-windows-vm stop; echo rc=$?` → `...not configured. Please run: omarchy-windows-vm install` and `Windows VM not configured.`, both `rc=1`.
  * Type `omarchy-windows-vm help; echo rc=$?` → the `Usage: omarchy-windows-vm [command] [options]` block listing install / remove / launch (`--keep-alive, -k`) / stop / status / help, `rc=0`; `omarchy-windows-vm frobnicate; echo rc=$?` → `Unknown command: frobnicate` + usage, `rc=1`. Type `omarchy-windows-vm remove` → `Remove Windows VM and delete all associated data?` with No preselected; press Enter → `Removal cancelled by user`. Type `omarchy-windows-key; echo rc=$?` → `No Windows license key found in firmware.`, `rc=1` (OVMF has no MSDM table; reviewer 11 notes a sudo prompt may precede it — type `prime` if so).
  ** `omarchy windows vm status` / `omarchy windows key` are the same commands through the router. None of these need Docker or a password; a polkit dialog here is a finding (cancel it and report).
  * Type `df -h ~ | tail -1; ls -l /dev/kvm 2>&1; ls -d ~/.windows ~/Windows ~/.local/share/applications/windows-vm.desktop 2>&1` → free space well under 74 G, KVM present or absent (note which), and three `No such file`.
  * Open the Omarchy Menu (Super+Space) → Install → `Windows` (enabled; not dimmed because no `windows-vm.desktop` exists). The floating terminal starts `omarchy-windows-vm install`:
  ** No `/dev/kvm`: a boxed `❌ KVM virtualization not available!` with `sudo modprobe kvm-intel / kvm-amd` hints, then `● Failed (exit code 1)!`. The check may come after the RAM/cores/disk questions — answer them with Enter to accept the defaults (4G, 2, 64G) and leave username/password blank.
  ** `/dev/kvm` present: after the questions, `❌ Insufficient disk space!` with `Available: NNGB` and `Required: 74GB (64GB disk + 10GB for Windows image)`, then `Failed`. No polkit prompt is expected before the check; if one appears, authorize with `prime` and report it.
  ** If instead the installer proceeds (`Monitor installation progress at: http://127.0.0.1:8006` or a Docker pull), press Ctrl+C (`Installation cancelled by user`) and report that the check was not exercised. Press a key to close.
  * In the terminal `ls -ld ~/.windows ~/Windows` → both now exist as `drwx------` (created before the check — note it); `ls ~/.local/share/applications/windows-vm.desktop 2>&1` → `No such file`; `sudo ls /var/lib/omarchy/windows 2>&1` → absent or empty (no compose file); `omarchy-pkg-present freerdp; echo $?` → `1`; `omarchy-windows-vm status` → still `Windows VM not configured.`
  * Menu → Install: `Windows` still enabled; Menu → Remove: still no `Windows` row. Type `rmdir ~/.windows ~/Windows` to leave the home directory as found; close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The boxed error is drawn by gum; screenshot before pressing a key.
  * Skipped here: the 10–15 minute Windows download, RDP session, shared folder, `--keep-alive`, Remove → Windows — they need nested KVM and a ≥ 80 GB disk.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Each subcommand message with its `rc`; the usage block; the cancelled removal; the windows-key message
  ** The pre-state line; the KVM or disk-space box and `Failed (exit code 1)!`; the two 0700 directories, no desktop file, no compose file, `1`, `not configured`; the unchanged Install/Remove menus
  * If unsuccessful
  ** A polkit/sudo prompt or hang on the unconfigured commands, the installer proceeding to a download (then Ctrl+C) — report which prerequisite check was skipped — or any package or desktop file created despite the failed check
covers: manual/28-windows-vm.md:3-7,17-24,47-49; default/omarchy/omarchy-menu.jsonc:215,296 (install.windows, remove.windows); bin/omarchy-windows-vm:1126-1153,1520-1553 (status/launch/stop/help/remove dispatch, install_windows, check_prerequisites, available_storage_gb, prepare_user_mount_sources); bin/omarchy-windows-key; test/shell.d/windows-vm-test.sh; test/shell.d/windows-vm-compose-test.sh (disk-space); test/shell.d/menu-test.sh
merged-from: 23:windows-vm-install-refuses-small-disk; 11:windows-vm-install-refused-in-guest; 52:windows-vm-install-refuses-insufficient-space; 23:windows-vm-unconfigured-commands; 11:windows-vm-cli-status-key-help

### security-fido2-without-device-and-removers-on-stock   [VM-PARTIAL] [NET]
description: The security removers are safe on a stock disk where nothing was set up (sudoless-docker and sshd report cleanly, fingerprint is a no-op, ssh keeps working); Setup → Security → Fido2 installs the FIDO2 packages, then stops with "No FIDO2 device detected" without touching PAM, which makes the Remove → Security → Fido2 row appear, and that remover either cleans up or trips pacman's `libfido2` / openssh dependency error (01-FACTS: likely — recorded as a defect). Enrolment needs a key; the software half is covered.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `grep -c pam_u2f /etc/pam.d/sudo` → `0`; `pacman -Q pam-u2f libfido2 2>&1` → pam-u2f not found (record whether libfido2 is already present as an openssh dependency). Open the Omarchy Menu (Super+Space) → Remove: no Security row on a stock disk. Escape.
  * Type `omarchy-remove-security-sudoless-docker; echo rc=$?` → `Sudoless Docker is not enabled: prime is not in the docker group.`, `rc=0`, no reboot prompt. Type `omarchy-remove-security-sshd; echo rc=$?` → green `Removing SSH server access.`, the stop/disable and firewall lines (sudo `prime`), no authorized-keys question, `The openssh package remains installed since it also provides the ssh client.`, `rc=0`.
  * Type `omarchy-remove-security-fingerprint; echo rc=$?` → the headline, `Removing fingerprint packages...` with no transaction, a green completion line, `rc=0`. Type `ssh -V; sudo ufw status | grep -c 22/tcp` → ssh still works and `0`.
  * Menu → Setup → Security → Fido2: floating terminal, green `Setting up FIDO2 device for authentication.`, `Installing required packages...` (sudo `prime`; pacman installs libfido2 and pam-u2f, small download), then red `No FIDO2 device detected. Please plug it in (you may need to unlock it as well).` and `● Failed (exit code 1)!`. Press a key.
  * In the terminal `pacman -Q pam-u2f libfido2` → both listed; `grep -c pam_u2f /etc/pam.d/sudo` → `0` (PAM untouched); `ls /etc/fido2 2>&1` → `No such file`.
  * Menu → Remove (reopen twice) → Security → the Fido2 row is now present; select it → floating terminal `Removing FIDO2 device from authentication.`, `Removing FIDO2 packages...` (sudo). Record the outcome: either green `FIDO2 authentication has been completely removed.` and `Done!`, or pacman `removing libfido2 breaks dependency 'libfido2' required by openssh` with `Failed (exit code 1)` (a defect to file).
  ** If the remover failed, type `omarchy-pkg-drop pam-u2f` in the terminal to restore stock and report it.
  * `pacman -Q pam-u2f 2>&1` → not found; `ssh -V` → still works; Menu → Remove: the Security row hidden again. Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * All four removers are idempotent; re-running any is harmless. `omarchy-pkg-drop` may also remove now-unneeded dependencies; that is expected.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** `0`, the package state, and the Remove menu without Security; each remover's output with its `rc`; `ssh -V` and `0`
  ** The Fido2 setup terminal ending in the red no-device message and `Failed (exit code 1)`; pacman showing both packages, PAM grep `0`, no `/etc/fido2`; the Remove → Security → Fido2 row appearing
  ** The removal transcript with its outcome captured clearly (clean, or the libfido2/openssh dependency error), pam-u2f gone, ssh working, Security hidden again
  * If unsuccessful
  ** PAM modified (grep > 0) without a device, a remover hanging on a prompt, ssh broken afterwards, or `./client get-serial`
covers: manual/37-hardware-authentication.md (Fido2 authentication); bin/omarchy-setup-security-fido2; bin/omarchy-remove-security-fido2; bin/omarchy-remove-security-sshd; bin/omarchy-remove-security-sudoless-docker; bin/omarchy-remove-security-fingerprint; default/omarchy/omarchy-menu.jsonc (setup.security.fido2, remove.security.* when)
merged-from: 12:fido2-setup-without-device-then-remove; 23:remove-security-when-nothing-enabled

### plugin-add-local-repo-enable-disable-remove   [VM-OK]
description: A third-party bar widget can be added from a git repository made inside the guest (no network), enabled so it appears on the bar, disabled, re-enabled into another section, and removed, with `omarchy-plugin-list` following each step; a hostile `ext::` URL is refused by the URL check before anything is cloned.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter) and create the plugin repo by typing these lines exactly:
    `mkdir -p /tmp/hello && cd /tmp/hello`
    `printf '%s\n' '{"schemaVersion":1,"id":"prime.hello","name":"Hello","version":"1.0.0","kinds":["bar-widget"],"entryPoints":{"barWidget":"Hello.qml"},"barWidget":{"displayName":"Hello","defaultSection":"right"}}' > manifest.json`
    `printf '%s\n' 'import QtQuick' 'import qs.Ui' 'BarWidget { moduleName: "prime.hello"; implicitWidth: label.implicitWidth + 16; implicitHeight: barSize; Text { id: label; anchors.centerIn: parent; text: "HELLO"; color: "#ff0000"; font.pixelSize: 14 } }' > Hello.qml`
    `git init -q && git add -A && git -c user.name=t -c user.email=t@t commit -qm init && cd ~`
  * Type `omarchy-plugin-add 'ext::sh -c id'; echo exit=$?` → refused by the URL check before any warning or clone, non-zero exit.
  * Type `omarchy-plugin-add /tmp/hello --enable --yes` → `Added prime.hello into /home/prime/.config/omarchy/plugins/prime.hello` and `Enabled prime.hello`; within ~2 s a red `HELLO` label appears on the right side of the bar. Type `omarchy-plugin-list` → a row `prime.hello  enabled  third-party  bar-widget  Hello`.
  * Type `omarchy-plugin-disable prime.hello` → `Disabled prime.hello`; `HELLO` disappears from the bar.
  * Type `omarchy-plugin-enable prime.hello left` → `Enabled and moved prime.hello`; `HELLO` now shows on the left side of the bar.
  * Type `omarchy-plugin-remove prime.hello --yes` → `Removed prime.hello.` and `Plugin was enabled and was unloaded from omarchy-shell.`; `HELLO` is gone and `omarchy-plugin-list` no longer lists it. Type `rm -rf /tmp/hello`; close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Type each printf line as one line; the quotes matter. `cat manifest.json Hello.qml` lets you check them before committing.
  * The red HELLO is small; zoom into the bar. If it does not show within 5 s, run `journalctl -t omarchy-shell --since -1min --no-pager | grep -i hello | sudo tee /dev/ttyS0` and report via get-serial.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Terminal: the `ext::` refusal, the Added/Enabled lines, the list row, Disabled, Enabled and moved, Removed
  ** Bar screenshots: HELLO on the right, gone, on the left, gone again
  * If unsuccessful
  ** `refusing to add: validation failed` with its reason, `plugin 'prime.hello' is not known`, an `ext::` URL accepted, or a HELLO that never renders
covers: bin/omarchy-plugin-add; bin/omarchy-plugin-validate; bin/omarchy-plugin-enable; bin/omarchy-plugin-disable; bin/omarchy-plugin-remove; bin/omarchy-plugin-list; bin/omarchy-git-url-check (bare path, ext:: refusal); shell/services/PluginRegistry.qml (scan, setEnabled, barTarget); shell/shell.qml (syncPluginWidgets, listPlugins IPC); shell/Ui/BarWidget.qml; manual/32-shell-plugins.md; test/shell.d/plugin-add-test.sh; plugin-enable-test.sh; runtime-smoke-test.sh
merged-from: 32:plugin-add-local-enable-disable-remove

### plugin-clone-builtin-edit-and-remove-restores   [VM-OK]
description: Cloning a built-in widget creates an editable `prime.<name>` copy that replaces the original in place (toast, list, manifest `clonedFrom`), a saved edit hot-reloads onto the bar, the refusals hold (already cloned, unknown built-in, custom id, not built-in, removing a built-in, unconfirmed removal, bad id), the menu's Clone picker stops offering the cloned widget while the guarded Remove Plugin row appears, and removing the clone from the menu backs it up and restores the built-in.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Screenshot the bar: the centre clock shows weekday and time (e.g. `Friday 13:10`). Open a terminal with Super+Enter and type `omarchy-menu-plugin remove; echo rc=$?` → notification `No plugin to remove`, `rc=0`. Open the Omarchy Menu (Super+Space) → Setup → Plugins: rows Enable, Disable, Add, Clone present; no `Remove Plugin` row. Escape.
  * Type `omarchy-plugin-clone omarchy.clock` (answer `y` if it asks) → `Cloned omarchy.clock to /home/prime/.config/omarchy/plugins/prime.clock and switched to prime.clock`; a notification `Editing Cloned Plugin` appears; the clock is still on the bar. Type `omarchy-plugin-list | grep -i clock` → `prime.clock  enabled  third-party  bar-widget  My Clock` and `omarchy.clock  disabled  first-party …`; `ls ~/.config/omarchy/plugins/prime.clock/` → `manifest.json BarWidget.qml Panel.qml Model.js`; `jq -r '.id,.name,.omarchy.clonedFrom' ~/.config/omarchy/plugins/prime.clock/manifest.json` → `prime.clock`, `My Clock`, `omarchy.clock`.
  * Type `sed -i 's/text: root.vertical ? "" : root.displayText/text: root.vertical ? "" : "CLONE " + root.displayText/' ~/.config/omarchy/plugins/prime.clock/BarWidget.qml` and wait 3 s → the bar clock reads `CLONE Friday 13:11` (live time): the saved file hot-reloaded without a restart.
  ** If `sed` matched nothing (`grep -n displayText ~/.config/omarchy/plugins/prime.clock/BarWidget.qml` shows a different line), edit that line to prefix `"CLONE " +` and report the difference.
  * Refusals, each non-zero: `omarchy-plugin-clone omarchy.clock; echo $?` → `… already exists`, `1`; `omarchy-plugin-clone omarchy.nosuch; echo $?` → `unknown built-in plugin: omarchy.nosuch`, `1`; `omarchy-plugin-clone omarchy.weather custom.weather` (custom id) and `omarchy-plugin-clone prime.clock` (not built-in) fail and `ls -d ~/.config/omarchy/plugins/prime.weather 2>&1` → No such file; `omarchy-plugin-remove omarchy.clock; echo $?` → refused (a built-in has no checkout); `echo | omarchy-plugin-remove prime.clock; echo $?` → `refusing to continue without confirmation; pass --yes`, the clone still exists; `omarchy-plugin-remove nosuch --yes; echo $?` → `plugin 'nosuch' is not installed`, `1`; `omarchy-plugin-remove 'bad/id' --yes; echo $?` → `invalid plugin id`, `1`.
  * Menu → Setup → Plugins → Clone Plugin: the picker does NOT offer Clock any more (already cloned) but offers e.g. Weather; Escape. Setup → Plugins → Disable Plugin: rows show the plugin name with its id underneath; Escape. Reopen Setup → Plugins twice: `Remove Plugin` is now listed.
  * Select Remove Plugin → the picker lists `My Clock (prime.clock)`; choose it → a floating terminal asks `Remove 'prime.clock'? The folder will be backed up.` → Yes → `Removed prime.clock. Backup at: …/plugins/.prime.clock.bak.<timestamp>` and `Restored omarchy.clock.`; `Done!`. Press a key.
  * Within 3 s the bar clock shows the plain time again. In the terminal `omarchy-plugin-list | grep -i clock` → only `omarchy.clock  enabled  first-party`; `ls -a ~/.config/omarchy/plugins/` shows the `.prime.clock.bak.*` dir — remove it with `rm -rf ~/.config/omarchy/plugins/.prime.clock.bak.*`. Reopen Setup → Plugins twice: `Remove Plugin` is gone. Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The clone id is `prime.clock` because the login name is `prime`. The Remove Plugin row is guarded: reopen the submenu twice after cloning or removing. Menu rows are `name` with the id as smaller subtext — pick by the id line.
  * The menu's Clone Plugin path does the same as the CLI and then opens the clone directory in the default editor (nvim — `$EDITOR` is `omarchy-launch-editor --inline` on Omarchy; CODE-INTENDED per 03-INTENDED-BEHAVIOUR #28); the CLI keeps the steps typeable.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The `No plugin to remove` toast and Setup → Plugins without Remove Plugin; the Cloned line, the `Editing Cloned Plugin` notification, both list rows, the directory listing and manifest fields
  ** Bar screenshots: normal clock → `CLONE …` clock → normal clock; every refusal with its exit code and no `prime.weather`
  ** Clone Plugin without a Clock row, Disable Plugin rows with id subtext, Remove Plugin present, the remove confirmation and its `Removed … Backup at … Restored omarchy.clock.` output; the final list row, the backup dir, Remove Plugin gone
  * If unsuccessful
  ** The clock disappearing from the bar, `CLONE` not appearing after 10 s, `omarchy.clock` not restored after removal, a clone created for a refused command, Remove Plugin acting on the wrong plugin, or `journalctl -t omarchy-shell --since -3min --no-pager | grep -iE 'clock|plugin' | sudo tee /dev/ttyS0`
  ** Output of `omarchy-version`
covers: bin/omarchy-plugin-clone; bin/omarchy-plugin-remove (clonedFrom restore); bin/omarchy-menu-plugin (clone, remove); bin/omarchy-plugin-enable; default/omarchy/omarchy-menu.jsonc (setup.plugin.clone / setup.plugin.remove when); shell/services/PluginRegistry.qml (clonedFrom, resolveEnabledId, restoreCloneSource, localPluginWatcher); shell/shell.qml (hot reload); shell/plugins/panels/clock/BarWidget.qml:150; docs/omarchy-shell.md §Installing a third-party plugin; default/agents/skills/omarchy/plugins.md §Customizing Built-In Plugins; manual/32-shell-plugins.md "Cloning a built-in"; test/shell.d/plugin-clone-test.sh; menu-plugin-test.sh; runtime-smoke-test.sh
merged-from: 32:plugin-clone-builtin-edit-and-remove; 25:plugin-clone-and-remove-restores-builtin; 52:plugin-clone-enable-remove-roundtrip; 22:menu-plugin-clone-and-remove; 61:plugin-clone-and-remove; 12:plugin-clone-clock-and-remove-restores

### pkg-add-omarchy-zsh-setup-and-restore   [VM-OK] [NET]
description: The org zsh package installs from the omarchy repository through `omarchy pkg add`, `omarchy-setup-zsh` makes new terminals start zsh with the Starship prompt and fzf bindings, and the documented `.bashrc` backup brings bash back; the session ends with `stop` so no shell change leaks.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `echo $0` → `bash`.
  * Type `omarchy pkg add omarchy-zsh` (password `prime`), then `omarchy-setup-zsh` → zsh and omarchy-zsh install; setup writes `~/.zshrc`, backs up `~/.bashrc` to `~/.bashrc.backup-<date>` and reports it.
  ** If `omarchy-setup-zsh` is not found, type `pacman -Ql omarchy-zsh | grep bin/` to find the setup command and report the name.
  * Close the terminal, open a new one with Super+Enter, type `echo $0; echo $ZSH_VERSION` → `zsh` (or `-zsh`) and a version; the prompt is the Starship prompt.
  * Press Ctrl+R → an fzf history search opens. Press Escape.
  * Type `cp "$(ls -t ~/.bashrc.backup-* | head -1)" ~/.bashrc && sudo pacman -R --noconfirm omarchy-zsh`.
  * Close the terminal, open a new one, type `echo $0` → `bash` again. Close it and end the session with `stop`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The package is a few MB from the omarchy repo; if pacman cannot find it, `sudo pacman -Sy` and retry once.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** bash before; zsh after with `$ZSH_VERSION` and the Starship prompt; the fzf Ctrl+R popup under zsh; bash after the restore
  * If unsuccessful
  ** The setup error or a terminal that fails to open; `cat ~/.bashrc | head -20`
covers: omarchy-zsh README "Install", "fzf Keybindings", "Uninstall"; omarchy-pkgs/pkgbuilds/omarchy-zsh; migrations/1786952219.sh; bin/omarchy-pkg-add
merged-from: 60:omarchy-zsh-install-and-restore

### pkg-add-omarchy-fish-setup-and-restore   [VM-OK] [NET]
description: The org fish package installs from the omarchy repository through `omarchy pkg add`, `omarchy-setup-fish` makes new terminals start fish with the fzf.fish bindings, and the `.bashrc` backup brings bash back; the session ends with `stop`.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy pkg add omarchy-fish` (password `prime`), then `omarchy-setup-fish` → fish and omarchy-fish install; `~/.bashrc` is backed up and set to launch fish.
  ** If `omarchy-setup-fish` is not found, type `pacman -Ql omarchy-fish | grep bin/` to find the setup command and report the name.
  * Close the terminal, open a new one with Super+Enter, type `echo $FISH_VERSION` → a version prints; the prompt is fish/Starship styled.
  * Press Ctrl+R, look, Escape; press Ctrl+Alt+P, look, Escape → the fzf.fish history search, then the process search, each opened.
  * Type `cp (ls -t ~/.bashrc.backup-* | head -1) ~/.bashrc; sudo pacman -R --noconfirm omarchy-fish`.
  * Close the terminal, open a new one, type `echo $0` → `bash`. Close it and end the session with `stop`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * fish syntax: command substitution is `(…)`, not `$(…)`.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** fish running with `$FISH_VERSION`; the Ctrl+R and Ctrl+Alt+P popups; bash restored
  * If unsuccessful
  ** The setup error; `cat ~/.bashrc | head -20`
covers: omarchy-fish README; omarchy-pkgs/pkgbuilds/omarchy-fish; bin/omarchy-pkg-add
merged-from: 60:omarchy-fish-install-and-restore

### preinstalls-base-package-set-installed-audit   [VM-OK]
description: Every package in the shipped `omarchy-base.packages` manifest (the preinstall source list) plus the boot/base essentials is installed on the minted disk, hardware-only packages are not, the stable repository is configured (no `[offline]` leftover), and the audit visibly catches a missing package; the Install → Preinstalls row reads as installed and Remove → Preinstalls is offered (its behaviour has no source block and is only observed).
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `ls -l /usr/share/omarchy/install/omarchy-base.packages` → the file exists; `grep -vE '^\s*(#|$)' /usr/share/omarchy/install/omarchy-base.packages | wc -l` → about 149.
  ** If it does not exist on the 4.0.2 disk, run `ls /usr/share/omarchy/install/` and report the contents.
  * Type `grep -Ev '^\s*(#|$)' /usr/share/omarchy/install/omarchy-base.packages | while read -r p; do pacman -Q "$p" >/dev/null 2>&1 || echo "MISSING $p"; done | sudo tee /dev/ttyS0; echo AUDIT-DONE` (password `prime` if asked). The loop can take up to a minute on 2 vCPUs; screenshot every 5 s until `AUDIT-DONE`. There must be no `MISSING` lines on screen or in the serial log.
  * Type `pacman -Qq omarchy omarchy-settings omarchy-nvim omarchy-keyring linux-omarchy linux-omarchy-headers limine limine-mkinitcpio-hook limine-snapper-sync snapper zram-generator btrfs-progs efibootmgr openssh pipewire pipewire-pulse wireplumber` → all names echoed back, no error. Type `cat /usr/share/omarchy/version; pacman -Q omarchy` → the installed version pair (report it; the disk is from the 4.0.2 ISO).
  * Unhappy path: `pacman -Qq nvidia-utils linux-t2 t2fanrd 2>&1` → three `error: package '…' was not found`; `pacman -Q not-a-real-package; echo rc=$?` → `was not found` and `rc=1`.
  * Type `grep -E '^\[|^Server|^Include' /etc/pacman.conf | head; head -3 /etc/pacman.d/mirrorlist` → the stable omarchy repo/mirrorlist (no `[offline]` file:// server).
  * Open the Omarchy Menu (Super+Space) → Install: `Preinstalls` dimmed ✓; Menu → Remove: a `Preinstalls` row is present — do not select it; screenshot only. Escape; close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The `sudo tee` copy exists so a long MISSING list can be read with get-serial.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The count, `AUDIT-DONE` with no `MISSING` lines (serial log empty of MISSING), the essentials list, the version pair, the three not-found errors and `rc=1`, the pacman.conf without `[offline]`, the two Preinstalls rows
  * If unsuccessful
  ** The `MISSING <pkg>` lines on screen or in the serial listing, or a leftover `[offline]` repo
covers: install/omarchy-base.packages; install/omarchy-other.packages; omarchy-iso _runtime_package_list/_early_packages; install/post-install/pacman.sh; install/hardware/pacman.sh; test/shell.d/preinstalls-test.sh (base list is the preinstall source); test/acceptance.d/system-test.sh:8-25; default/omarchy/omarchy-menu.jsonc (install.preinstalls, remove.preinstalls)
merged-from: 42:base-packages-installed; 50:system-core-packages-installed

### dev-env-php-pacman-install-and-remove   [VM-OK] [NET]
description: The PHP environment is the pacman-based dev-env: Install → Development → PHP → PHP installs php/composer/xdebug (~25 MB), enables extensions in `/etc/php/php.ini` under sudo and adds Composer's bin to PATH, dims its row, and Remove → Development → PHP drops the packages again.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `php -v 2>&1` → `command not found`. Open the Omarchy Menu (Super+Space) → Install → Development → PHP → PHP.
  ** Floating terminal: `Installing PHP...`, sudo `prime`, pacman installs `php composer php-sqlite xdebug`, `Added Composer global bin directory to PATH.`, `Done!`. Press a key.
  * In the terminal type `php -v` → `PHP 8.x` and a `with Xdebug` line.
  * Type `grep -E '^extension=(bcmath|intl|pdo_sqlite)' /etc/php/php.ini` → three uncommented lines.
  * Menu → Install → Development → PHP (reopen twice): `PHP` dimmed ✓. Menu → Remove → Development → PHP: `PHP` listed; click it.
  ** Floating terminal: `Removing PHP...`, sudo, pacman removes the four packages, `Done!`. Press a key.
  * In the terminal type `php -v 2>&1` → `command not found`; Menu → Install → Development → PHP → `PHP` enabled again. Close the terminal with Super+W.
  ** The PATH line added to `.bashrc` survives removal; that is expected.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * PHP is a CLI toolchain with no launcher entry; `php -v` is the visible proof.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** `command not found` before; `Installing PHP...` / `Done!`; `php -v` with Xdebug; the three `extension=` lines; the dimmed row and the Remove row; `Removing PHP...` / `Done!`; `command not found` after
  * If unsuccessful
  ** pacman/sed errors in the floating terminal
covers: bin/omarchy-install-dev-env (php); bin/omarchy-remove-dev-env (php); default/omarchy/omarchy-menu.jsonc (install.development.php.php, remove.development.php.php)
merged-from: 23:dev-env-php-pacman-path

### install-editor-helix-theme-alias-and-cleanup   [VM-OK] [NET]
description: `omarchy-install-editor-helix` (the Install → Editor → Helix row) installs Helix (~20 MB) wired to the live Omarchy theme with an `hx` alias, lands it in the launcher and dims its row, is idempotent (no duplicate alias), and — having no remover — is cleaned up with `omarchy-pkg-drop`, which leaves `~/.config/helix` behind as documented.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy-install-editor-helix` → `Installing Helix...`, sudo `prime`, pacman installs `helix`.
  * Type `cat ~/.config/helix/config.toml; ls -l ~/.config/helix/themes/omarchy.toml; grep 'alias hx' ~/.bashrc` → `theme = "omarchy"`, a symlink into `~/.local/state/omarchy/current/theme/helix.toml`, and `alias hx="helix"`.
  * Open a new terminal (Super+Enter) and type `hx --version` → `helix 2x.yy`.
  * Open Apps (Super+Alt+Space), type `helix` → a `Helix` entry is listed. Escape. Open the Omarchy Menu (Super+Space) → Install → Editor (reopen twice): `Helix` dimmed ✓.
  * In the terminal type `omarchy-install-editor-helix; grep -c 'alias hx' ~/.bashrc` → no reinstall, and the count is `1` (no duplicate alias).
  * Type `omarchy-pkg-drop helix; hx --version` → pacman removes helix; `command not found`; `ls ~/.config/helix` still lists the config (documented leftover — expected per 03-INTENDED-BEHAVIOUR #30). Apps → `helix` → gone; Menu → Install → Editor → `Helix` enabled again. Close the terminals with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * `hx` only exists in a shell opened after the install; the first terminal will not know it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The three config checks; `hx --version`; the launcher entry and dimmed row; `1` from `grep -c`; `command not found` after the drop with the launcher and menu back to stock
  * If unsuccessful
  ** The failing check's output or a duplicated alias line
covers: bin/omarchy-install-editor-helix; bin/omarchy-pkg-drop; default/omarchy/omarchy-menu.jsonc (install.editor.helix)
merged-from: 23:install-editor-helix-cli-and-cleanup

### install-service-nordvpn-decline-reboot-and-drop   [VM-PARTIAL] [NET]
description: Install → Service → NordVPN installs and enables the daemon (~30 MB), adds the user to the `nordvpn` group and offers a reboot; declining keeps the session up, the row dims, and — with no Remove row (a design choice, 03-INTENDED-BEHAVIOUR #29 UNCLEAR; record it) — `omarchy-pkg-drop nordvpn-bin` cleans up. Login is not possible in the guest.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Omarchy Menu (Super+Space) → Install → Service → NordVPN.
  ** Floating terminal: `Installing NordVPN...`, sudo `prime`, `Enabling NordVPN daemon...`, `Adding user to nordvpn group...`, `NordVPN installed! After reboot, run 'nordvpn login' to authenticate.`, then `Reboot now to make NordVPN usable?` — choose **No**. `Done!`. Press a key.
  * Open a terminal (Super+Enter) and type `systemctl is-active nordvpnd; id -nG | grep -c nordvpn` → `active` and `1`.
  * Type `nordvpn status` → a permission or "not logged in" message, not a crash.
  * Menu → Install → Service (reopen twice): `NordVPN` dimmed ✓. Menu → Remove → Services: no NordVPN row (no remover exists — record which Install → Service rows lack a Remove row).
  * In the terminal type `omarchy-pkg-drop nordvpn-bin; systemctl is-active nordvpnd` → pacman removes it; `inactive` / `unknown`. Menu → Install → Service → `NordVPN` enabled again. Close the terminal with Super+W.
  ** The `nordvpn` group membership only takes effect after a re-login; the session is left as found otherwise.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Never answer Yes to the reboot within the test. Skipped: `nordvpn login` (needs an account).
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Install output ending at the declined reboot and `Done!`; `active` and `1`; the `nordvpn status` message; the dimmed row and the absent Remove row; the cleanup with the row enabled again
  * If unsuccessful
  ** pacman/systemd errors, or a reboot despite No
covers: bin/omarchy-install-service-nordvpn; bin/omarchy-pkg-drop; default/omarchy/omarchy-menu.jsonc (install.service.nordvpn)
merged-from: 23:install-service-nordvpn-no-reboot

### install-gaming-xbox-controllers-xpadneo-and-remove   [VM-PARTIAL] [NET] [SLOW]
description: Install → Gaming → Xbox Controllers builds the xpadneo DKMS module (1–3 min on 2 vCPU), blacklists xpad and offers a reboot when the input group is new; without a controller or Bluetooth only the software path — the two config files, the dimmed row — and Remove → Gaming → Xbox Controllers are verified.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Omarchy Menu (Super+Space) → Install → Gaming → Xbox Controllers.
  ** Floating terminal: `Installing Xbox controller Bluetooth support...`, sudo `prime`, pacman installs `xpadneo-dkms`, DKMS builds the module (`Building module...`; screenshot every ≤5 s).
  * Watch the ending: either `Reboot needed to finish setup. Reboot now?` — choose **No** → `Done!`; or `Now you can pair your Xbox controller with Bluetooth using Super + Ctrl + B.` → `Done!`. Record which. Press a key.
  * Open a terminal (Super+Enter) and type `cat /etc/modprobe.d/blacklist-xpad.conf /etc/modules-load.d/xpadneo.conf` → `blacklist xpad` and `hid_xpadneo`.
  * Menu → Install → Gaming (reopen twice): `Xbox Controllers` dimmed ✓. Menu → Remove → Gaming → `Xbox Controllers` → floating terminal removes the package and both files, prints `Reboot to fully unload xpadneo and restore xpad.`, `Done!`. Press a key.
  * In the terminal type `ls /etc/modprobe.d/blacklist-xpad.conf /etc/modules-load.d/xpadneo.conf 2>&1` → both `No such file`; `pacman -Q xpadneo-dkms 2>&1` → not found. Menu → Install → Gaming → `Xbox Controllers` enabled again; Menu → Remove: no Gaming row. Close the terminal with Super+W.
  ** Do not reboot within the test; the loaded module state is left as found by the removal's own instruction.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Never answer Yes to the reboot prompt inside this test.
  * A DKMS "missing kernel headers" error is a real failure: `linux-omarchy-headers` should be preinstalled.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The DKMS build output; the reboot prompt answered No (or the pairing message); the two config files; the dimmed row; the removal output and both files gone with the menus back to stock
  * If unsuccessful
  ** The DKMS/pacman error text
covers: bin/omarchy-install-gaming-xbox-controllers; bin/omarchy-remove-gaming-xbox-controllers; install/omarchy-other.packages (linux-omarchy-headers); default/omarchy/omarchy-menu.jsonc (install.gaming.xbox-controllers, remove.gaming.xbox-controllers)
merged-from: 23:gaming-xbox-controllers-driver-without-bluetooth

### hermes-cli-stub-owned-remove-restore-and-foreign   [VM-OK]
description: Without Hermes Desktop the `hermes` command is an Omarchy-owned lazy stub: `--owns`/`--check` say owned but cold, `--remove` clears it idempotently, a plain call restores it, its migration repairs a lost executable bit and respects the preinstalls opt-out, and a `hermes` the user wrote is never touched; the OpenClaw stub probe answers not-installed. No network.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `head -3 ~/.local/bin/hermes` → the third line is `# Written by omarchy-install-hermes-cli.`; `omarchy-install-hermes-cli --owns; echo owns=$?; omarchy-install-hermes-cli --check; echo check=$?` → `owns=0`, `check=1`.
  * Type `chmod -x ~/.local/bin/hermes; bash /usr/share/omarchy/migrations/1787760281.sh; ls -l ~/.local/bin/hermes` → the migration made it executable again.
  * Type `omarchy-install-hermes-cli --remove; echo rc=$?; ls ~/.local/bin/hermes 2>&1` → `rc=0` and `No such file`; `omarchy-install-hermes-cli --remove; echo rc=$?` → `rc=0` again (nothing owned, nothing to do).
  * Type `omarchy-install-hermes-cli; omarchy-install-hermes-cli --owns; echo owns=$?` → the stub is back, `owns=0`.
  * Foreign file: `omarchy-install-hermes-cli --remove; printf '#!/bin/bash\necho mine\n' > ~/.local/bin/hermes; chmod +x ~/.local/bin/hermes; omarchy-install-hermes-cli --owns; echo owns=$?; omarchy-install-hermes-cli; echo rc=$?; bash /usr/share/omarchy/migrations/1787760281.sh; omarchy-install-hermes-cli --remove; cat ~/.local/bin/hermes` → `owns` non-zero, a message that `~/.local/bin/hermes` is not Omarchy's (`...was not installed by Omarchy.` or `...does not support the interactive seeded sessions...`) with `rc=1`, and the file still reads `echo mine` byte for byte.
  * Opt-out: `rm ~/.local/bin/hermes; touch ~/.local/state/omarchy/preinstalls-removed; bash /usr/share/omarchy/migrations/1787760281.sh; ls ~/.local/bin/hermes 2>&1; rm ~/.local/state/omarchy/preinstalls-removed` → no stub written for a user who removed the preinstalls.
  * Restore: `bash /usr/share/omarchy/migrations/1787760281.sh; grep -c 'exec env -u UV_PYTHON mise x' ~/.local/bin/hermes; omarchy-install-hermes-cli --owns; echo owns=$?; omarchy-install-openclaw-cli --check; echo rc=$?` → `1`, `owns=0` (the stock stub is back), OpenClaw `rc=1` (not installed). Close the terminal with Super+W.
  ** None of these commands should touch the network; a `mise` download means something went wrong.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * `--owns`, `--check`, `--remove` answer only with their exit status; always echo it.
  * Never run `hermes --version` or `--now`: that installs Python 3.13 + Hermes (minutes, hundreds of MB).
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The marker line; `owns=0 check=1`; the executable bit repaired; the removal and idempotent `rc=0`; the restored stub; the foreign wrapper disowned, refused with `rc=1` and preserved; nothing written under the opt-out; the stock stub recreated with `1`/`owns=0`; OpenClaw `rc=1`
  * If unsuccessful
  ** A differing code, a foreign `hermes` file that was modified or deleted, `--owns` claiming it, or a mise download
covers: bin/omarchy-install-hermes-cli; bin/omarchy-install-openclaw-cli; migrations/1787760281.sh; test/shell.d/hermes-cli-test.sh (owns/check/remove/template/foreign); test/shell.d/hermes-cli-migration-test.sh (plain install, repair, opt-out, foreign left alone); manual/17-ai.md
merged-from: 23:hermes-cli-stub-lifecycle; 51:hermes-cli-stub-ownership

### plugin-update-local-origin-fast-forward-and-rollback   [VM-OK]
description: `omarchy plugin update` fast-forwards an installed third-party plugin from its origin and hot-reloads it onto the bar, reports up-to-date when nothing changed, refuses a duplicate add and an update of an uninstalled id, and rolls back a revision that fails validation; the menu's Add Plugin and Remove Plugin (`Delete '<id>'? Its git repo remains upstream.`) flows round it off — all from a local repository, no network.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter) and create and install the `/tmp/hello` plugin exactly as in `plugin-add-local-repo-enable-disable-remove` (same manifest and `Hello.qml`), first checking `omarchy-plugin-validate /tmp/hello; echo $?` → `0`, silent, then `omarchy-plugin-add /tmp/hello --enable --yes`. A red `HELLO` is on the bar and `omarchy-plugin-list | grep hello` → `prime.hello  enabled  third-party  bar-widget  Hello`.
  * Type `omarchy-plugin-add file:///tmp/hello --yes; echo $?` → `plugin id 'prime.hello' is already used by …manifest.json` (or `already installed; update it with: omarchy plugin update prime.hello`), `1`. Type `omarchy-plugin-update prime.hello --yes` → `prime.hello is up to date.`; `omarchy-plugin-update nosuch; echo $?` → `plugin 'nosuch' is not installed`, `1`.
  * Publish a change: `cd /tmp/hello && sed -i 's/HELLO/HELLO2/; s/1.0.0/1.0.1/' Hello.qml manifest.json && git -c user.name=t -c user.email=t@t commit -qam v2 && cd ~`. Type `omarchy-plugin-update prime.hello --yes` → `Updated prime.hello.`; within 3 s the bar label reads `HELLO2`; `jq -r .version ~/.config/omarchy/plugins/prime.hello/manifest.json` → `1.0.1`.
  * Publish a broken revision: `cd /tmp/hello && git mv Hello.qml Gone.qml && git -c user.name=t -c user.email=t@t commit -qm broken && cd ~`. Type `omarchy-plugin-update prime.hello --yes; echo "exit=$?"` → `entry point file not found: 'Hello.qml'`, `update of 'prime.hello' failed validation; rolled back`, `exit=1`; the bar still shows `HELLO2`; `ls ~/.config/omarchy/plugins/prime.hello/` → `Hello.qml` still there, no `Gone.qml`.
  * Open the Omarchy Menu (Super+Space) → Setup → Plugins (reopen twice) → `Remove Plugin` (present only while a third-party plugin is installed) → pick `Hello (prime.hello)` → floating terminal `Delete 'prime.hello'? Its git repo remains upstream.` → Yes → `Removed prime.hello.` (a git checkout: deleted, no backup) → `Done!`. `HELLO2` leaves the bar; `omarchy-plugin-list | grep -c hello` → `0`; `omarchy-plugin-update prime.hello; echo exit=$?` → `plugin 'prime.hello' is not installed`, `exit=1`.
  * Menu path for adding: `cd /tmp/hello && git reset -q --hard HEAD~1 && cd ~` (back to the good revision), then Setup → Plugins → `Add Plugin` → floating terminal prompts `Git URL of the plugin repo:`; type `file:///tmp/hello`, Enter → the ⚠️ warning and `Clone and add this plugin?` → Yes → `Added…` → `Enable 'prime.hello' now?` → No → `Enable it later with: omarchy plugin enable prime.hello`; Done. Then `omarchy-plugin-remove prime.hello --yes` → `Removed prime.hello.`; `rm -rf /tmp/hello`. Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The installed copy's origin is `/tmp/hello`, so committing there is "publishing a new version". Without `--yes` the update shows a diff and asks with gum; `--yes` keeps it unattended.
  * Menu rows show the plugin name with its id underneath; pick by the id line. If the shell logs a QML warning that is acceptable; a bar restart is not.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Terminal: validate `0`, the Added/Enabled lines and list row, the duplicate refusal and `not installed` with `1`, `up to date`, `Updated` + `1.0.1`, the validation failure with `rolled back` and `exit=1`, the listing with `Hello.qml`
  ** Bar screenshots: `HELLO` → `HELLO2` → still `HELLO2` after the failed update → gone after the menu removal; the `Delete 'prime.hello'?` confirm and `Removed prime.hello.`; the Add Plugin floating flow with the warning and both prompts
  * If unsuccessful
  ** `Gone.qml` present (broken revision kept), the widget vanishing, `Updated` printed for the broken revision, or `omarchy plugin list --json | jq '.[] | select(.id=="prime.hello")'` and `ls -la ~/.config/omarchy/plugins/`
covers: bin/omarchy-plugin-update (fetch/ff/validate/reset ORIG_HEAD); bin/omarchy-plugin-add; bin/omarchy-plugin-validate; bin/omarchy-plugin-enable; bin/omarchy-plugin-disable; bin/omarchy-plugin-remove; bin/omarchy-menu-plugin remove; bin/omarchy-git-url-check; default/omarchy/omarchy-menu.jsonc (setup.plugin.add, setup.plugin.remove when); shell/services/PluginRegistry.qml localPluginWatcher hot reload; manual/32-shell-plugins.md ("Updating is a fast-forward pull", Adding a plugin from git, Removal); test/shell.d/plugin-add-test.sh
merged-from: 32:plugin-update-local-origin-and-rollback; 25:plugin-add-local-git-repo-enable-update-remove; 12:plugin-add-local-git-repo-lifecycle

### plugin-add-from-public-git-url-and-unreachable   [VM-PARTIAL] [NET]
description: `omarchy plugin add <https-url>` clones a public plugin repository over the NAT, validates, enables and removes it, while an unreachable host and a non-existent repository fail cleanly with no `.add.tmp.*` leftovers; partial because the plugin directory listed nothing at review time — `omacom/elsewhen` (03-INTENDED-BEHAVIOUR #24: `omarchy plugin add https://github.com/omacom/elsewhen.git --enable` works) is the URL to use, verified first.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal (Super+Enter) and type `omarchy-plugin-add https://example.invalid/nope.git --yes; echo "exit=$?"` → `omarchy-plugin-add: failed to clone https://example.invalid/nope.git`, `exit=1`; `ls -a ~/.config/omarchy/plugins/` shows no `.add.tmp.*` leftovers.
  * Type `omarchy-plugin-add https://github.com/omacom-io/this-repo-does-not-exist-404.git --yes; echo $?` → git's "repository not found" / authentication error, then `omarchy-plugin-add: failed to clone …`, `1`; still no `.add.tmp.*`.
  * Verify the public plugin first: `git ls-remote https://github.com/omacom/elsewhen.git HEAD` succeeds; `git clone --depth 1 https://github.com/omacom/elsewhen.git /tmp/p && omarchy-plugin-validate /tmp/p; echo "exit=$?"` → `exit=0`; `rm -rf /tmp/p`.
  ** If `git ls-remote` fails, open `https://plugins.omarchy.org` (`xdg-open` from the terminal) and copy any listed plugin's git URL instead; if it lists none, report VM-PARTIAL (no public plugin available) and stop after the two negatives.
  * Type `omarchy-plugin-add https://github.com/omacom/elsewhen.git --enable --yes` (a few hundred KB; allow up to a minute over the NAT) → git clone progress, `Added <id> into …` and `Enabled <id>`; if it is a bar widget it appears on the bar (screenshot).
  ** If the manifest is not valid for this shell version, `refusing to add: validation failed` preceded by the exact validate error — report the URL and the error; that is a pass for the guard, not for the plugin.
  * Type `omarchy-plugin-list | grep -v first-party` → the plugin row is `enabled third-party`; `omarchy-plugin-update <id> --yes` → `<id> is up to date.`
  * Type `omarchy-plugin-remove <id> --yes` → `Removed <id>.`; the widget leaves the bar and `omarchy-plugin-list` no longer lists it. Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Network is outbound-only NAT; DNS works. `git ls-remote` failing means the URL is wrong, not the feature. `GIT_TERMINAL_PROMPT=0` is set by the script, so a private/missing repo fails instead of prompting.
  * Never add a repo you have not validated with `omarchy-plugin-validate` first. A hang > 2 min during clone is a network report, not a defect.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The clean failure for the invalid host and the 404 repo, each `exit=1` with a clean plugins dir; validate `exit=0`; Added/Enabled (or the validate refusal with its reason); the list row and `up to date`; Removed with the bar reverted
  * If unsuccessful
  ** The full stderr of the add, `ls -la ~/.config/omarchy/plugins/`, or a `.add.tmp.*` leftover
covers: bin/omarchy-plugin-add (https path, git clone path); bin/omarchy-git-url-check; bin/omarchy-plugin-validate; bin/omarchy-plugin-update; bin/omarchy-plugin-remove; manual/32-shell-plugins.md "Adding a plugin from git"
merged-from: 25:plugin-add-from-public-git-url; 32:plugin-add-from-git-url

## Not runnable here

### install-gaming-retroarch-cores-and-games-folder   [VM-NO] [NET] [SLOW]
description: Install → Gaming → RetroArch installs RetroArch with ~45 libretro cores (over 1 GB) and a `~/Games/{bios,roms}` layout with the Vulkan/XMB/CRT-Royale config, opens the ROM folder in Files, makes the RetroArch Game Launcher offer a core picker, and removal drops the cores but keeps ROMs and BIOS files. Too large for a session, and RetroArch's Vulkan driver has no ICD on virtio-vga.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Omarchy Menu (Super+Space) → Install → Gaming → RetroArch; sudo `prime`; ~50 packages (allow up to 8 minutes, screenshot every ≤5 s); wait for `Put your roms and bios files in ~/Games. Then start RetroArch from the app launcher (Super + Space).` and `Done!`. A Nautilus window for `~/Games` opens showing `bios` and `roms`; screenshot and close it.
  * Open a terminal (Super+Enter) and type `grep -E '^(video_driver|menu_driver|system_directory|rgui_browser_directory)' ~/.config/retroarch/retroarch.cfg` → `video_driver = "vulkan"`, `menu_driver = "xmb"`, the two `~/Games` paths; `cat ~/.config/retroarch/config/global.slangp` → `#reference "/usr/share/libretro/shaders/shaders_slang/crt/crt-royale.slangp"`.
  * Open Apps (Super+Alt+Space), type `retro` → `RetroArch` listed; launch it and report what happens: the XMB menu with the CRT shader (real GPU), or nothing / an error without a Vulkan ICD — `journalctl --user -n 20 | grep -i retroarch | sudo tee /dev/ttyS0` read via get-serial. Close it.
  * Menu → Install → Gaming → RetroArch Game Launcher now opens a core picker (many cores). Escape.
  * Menu → Remove → Gaming → RetroArch → floating terminal `RetroArch and its cores have been removed.` / `ROMs and BIOS files at ~/Games/roms and ~/Games/bios were left in place.` → `Done!`. In the terminal `ls ~/Games` → `bios` and `roms` still present; Apps → `retro` → gone.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * RetroArch needs Vulkan; on a software-only GPU it may fall back or fail to start — report what it does, that is the hardware limit, not the installer.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The installer's final lines with Nautilus on `~/Games`; the grep output and the slangp line; RetroArch running (or the launch attempt result); the core picker; the removal messages with `bios`/`roms` kept
  * If unsuccessful
  ** The red `Failed` line and `pacman -Q retroarch`, or the pacman output above the banner
covers: manual/26-gaming.md:19-33; default/omarchy/omarchy-menu.jsonc:254,262,322 (install.gaming.retroarch, remove.gaming.retroarch); bin/omarchy-install-gaming-retroarch; bin/omarchy-remove-gaming-retroarch; bin/omarchy-games-retro-install
merged-from: 23:install-gaming-retroarch; 11:install-retroarch-no-vulkan

### install-gaming-heroic-lutris-lib32-full-round-trip   [VM-NO] [NET] [SLOW]
description: Install → Gaming → Heroic (Epic Games) and → Lutris install their launchers with the lib32 driver set (Lutris also Wine, umu and winetricks with a pinned Python shebang), open them, and their removers wipe configs, libraries and Wine caches. Both call `omarchy-install-gaming-gpu-lib32` under `set -e`, which at HEAD leaks exit 1 without a GPU (03-INTENDED-BEHAVIOUR #1 DEFECT, pinned by the Steam test), and need ~120–600 MB — recorded for hardware runs.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Omarchy Menu (Super+Space) → Install → Gaming → Heroic (Epic Games); sudo `prime`; wait for `Done!`. The Heroic window opens (Electron; allow 20 s); screenshot and close it.
  ** With no Intel/AMD/NVIDIA GPU the floating terminal at HEAD ends `Failed (exit code 1)` before launching (gpu-lib32 helper; intended: continue as a no-op).
  * Open Apps (Super+Alt+Space), type `heroic` → listed; Menu → Install → Gaming: `Heroic (Epic Games)` dimmed ✓.
  * Menu → Remove → Gaming → Heroic (Epic Games) → `Heroic and its data have been removed.` → `Done!`. Apps → `heroic` → gone; in a terminal `ls -d ~/.config/heroic ~/Games/Heroic 2>&1` → both `No such file`.
  * Menu → Install → Gaming → Lutris; sudo `prime`; wait for the note `Lutris will open and auto-fetch its DXVK and VKD3D runtimes in the background...` and `Done!`. The Lutris window opens; screenshot its status bar fetching runtimes; close it.
  ** The shebang pin means `lutris` runs even when mise's Python is first on PATH; a Python import error at launch is the failure to report.
  * Apps → `lutris` → listed; Install → Gaming: `Lutris` dimmed ✓. Remove → Gaming → Lutris → `Lutris, Wine, umu-launcher, and their configs have been removed.` → `Done!`. Apps → `lutris` → gone; `ls -d ~/.wine ~/.config/lutris 2>&1` → both `No such file`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Each install is minutes of downloads on a real GPU machine; screenshot every 5 s.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** `Done!` for each; the Heroic and Lutris windows; launcher entries and dimmed rows; both removal messages; the missing directories
  * If unsuccessful
  ** The `Failed` banner and the output above it, or a Python traceback from Lutris
covers: bin/omarchy-install-gaming-heroic; bin/omarchy-remove-gaming-heroic; bin/omarchy-install-gaming-lutris; bin/omarchy-remove-gaming-lutris; bin/omarchy-install-gaming-gpu-lib32; default/omarchy/omarchy-menu.jsonc (install.gaming.heroic, install.gaming.lutris, remove.gaming.*)
merged-from: 23:install-gaming-heroic; 23:install-gaming-lutris

### install-gaming-geforce-now-flatpak   [VM-NO] [NET] [SLOW]
description: Install → Gaming → NVIDIA GeForce NOW installs Flatpak, runs NVIDIA's setup binary and opens a browser for login; removal uninstalls the Flatpak with its data. ~1 GB of Flatpak runtime — not runnable in the guest.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Omarchy Menu (Super+Space) → Install → Gaming → NVIDIA GeForce NOW; sudo `prime`; wait through the Flatpak install and the GeForce NOW setup output to `Done!`.
  * A browser window opens (the installer launches one so GFN's login does not hang); screenshot and close it.
  * Open Apps (Super+Alt+Space), type `geforce` → the GeForce NOW entry is listed; Menu → Install → Gaming: `NVIDIA GeForce NOW` dimmed ✓.
  * Menu → Remove → Gaming → NVIDIA GeForce NOW → `GeForce NOW removed.` → `Done!`.
  * Apps → `geforce` → gone; in a terminal `flatpak info com.nvidia.geforcenow; echo $?` → an error and `1`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * NVIDIA's setup binary runs in the floating terminal and may prompt; answer its defaults.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** `Done!`; the browser window; the launcher entry and dimmed row; `GeForce NOW removed.`; `flatpak info` failing with `1`
  * If unsuccessful
  ** The `Failed` banner or the setup binary's error text
covers: bin/omarchy-install-gaming-geforce-now; bin/omarchy-remove-gaming-geforce-now; default/omarchy/omarchy-menu.jsonc (install.gaming.geforce-now, remove.gaming.geforce-now)
merged-from: 23:install-gaming-geforce-now

### install-ai-hermes-desktop-runtime-and-remove   [VM-NO] [NET] [SLOW]
description: Install → AI → Hermes Desktop installs the package, clones and builds the Hermes runtime under `~/.hermes` and opens the app; the remover refuses while the app runs and asks before deleting user data. Minutes of builds (10+ on 2 vCPU) and hundreds of MB — not runnable in the guest.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Omarchy Menu (Super+Space) → Install → AI → Hermes Desktop; sudo `prime`; wait for `Setting up the Hermes runtime...`, `Opening Hermes Desktop...`, `Matching Hermes to the current theme once it is set up...`, `Hermes Desktop has been installed.`, `Done!`.
  * The Hermes window opens; screenshot it and leave it running. In a terminal type `omarchy-install-hermes-cli --owns; echo $?; omarchy-install-hermes-cli --check; echo $?` → `1` then `0` (the app now owns `hermes`).
  * Menu → Remove → AI → Hermes Desktop → floating terminal `Close Hermes and processes using its files before removing it (PIDs: ...)` and `Failed`. Press a key.
  * Close Hermes (Super+W). Menu → Remove → AI → Hermes Desktop again; at `Also delete ~/.hermes and ~/.config/Hermes (...)?` choose **No** → `Hermes Desktop has been removed.` and `Your chats, memories, and skills are still in ~/.hermes`.
  * Apps (Super+Alt+Space) → `hermes` → no desktop entry; in the terminal `ls -d ~/.hermes` → still present.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The runtime bootstrap can take 10+ minutes on 2 vCPUs; keep screenshotting.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The installer's step lines and the window; `1`/`0`; the refused removal while running; the completed removal keeping `~/.hermes`
  * If unsuccessful
  ** The installer's guidance (e.g. `Run 'omarchy update', then try again.`) or the remover's stderr
covers: bin/omarchy-install-ai-hermes; bin/omarchy-remove-ai-hermes; bin/omarchy-install-hermes-cli; test/shell.d/hermes-desktop-install-test.sh; test/shell.d/hermes-remove-test.sh
merged-from: 23:install-ai-hermes-desktop

### install-ai-openclaw-onboarding-cancel   [VM-NO] [NET] [SLOW]
description: Install → AI → OpenClaw installs the package (~150 MB) and Control UI web app and then starts an interactive onboarding wizard; aborting the wizard must leave a removable state, and Remove → AI → OpenClaw must not delete `~/.openclaw` unasked. The operator notes list OpenClaw onboarding as out of the session budget — recorded for a longer run.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Omarchy Menu (Super+Space) → Install → AI → OpenClaw; sudo `prime`; ~150 MB (2–4 min), `Installing the OpenClaw web app...`, then the first onboarding prompt.
  * Screenshot the prompt, then press Ctrl+C. Record whether the floating terminal closes silently (exit 130) or shows `Failed` / `If you skipped onboarding, launching OpenClaw from the app grid resumes it.`
  * Open Apps (Super+Alt+Space), type `openclaw` → an `OpenClaw` entry is listed (the web app). Escape. In a terminal `ls ~/.openclaw/openclaw.json 2>&1; systemctl --user is-active openclaw-gateway.service` → `No such file` and `inactive`/not-found (onboarding never finished).
  * Menu → Install → AI: `OpenClaw` dimmed ✓. Menu → Remove → AI → OpenClaw → pacman removes openclaw; if asked `Also delete ~/.openclaw (...)?` answer **No**; `OpenClaw has been removed.`, `Done!`.
  * Apps → `openclaw` → gone; in the terminal `omarchy-pkg-present openclaw; echo $?` → `1`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Do not complete onboarding: it needs API credentials and starts a gateway service.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Install output; the wizard prompt; the launcher entry; no config and no gateway; dimmed row; removal output; entry gone and `1`
  * If unsuccessful
  ** A gateway left running, or the remover's `Could not stop ...; OpenClaw was not removed.` text
covers: bin/omarchy-install-ai-openclaw; bin/omarchy-remove-ai-openclaw; default/omarchy/omarchy-menu.jsonc (install.ai.openclaw, remove.ai.openclaw); test/shell.d/remove-ai-test.sh
merged-from: 23:install-ai-openclaw-onboarding-cancel

### windows-vm-full-install-launch-remove   [VM-NO] [NET] [SLOW]
description: The full Windows VM story — resource prompts, privileged compose, Windows 11 download, RDP launch with auto-stop, `-k` keep-alive, status box, removal — needs ≥ 74 GB free, nested KVM and a multi-GB download; recorded for hardware runs. The refusal half runs in `windows-vm-install-refused-and-unconfigured-commands`.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Omarchy Menu (Super+Space) → Install → Windows; accept the defaults through RAM (4G), cores (2), disk (64G), username (`docker`), password; confirm the summary box; authorize the polkit prompt (`prime`); see `Monitor installation progress at: http://127.0.0.1:8006` and the browser opening; wait for Windows to finish installing (screenshot every 5 s).
  * Open Apps (Super+Alt+Space), type `windows`, Enter → `Connecting to Windows VM` box, then a full-screen FreeRDP window titled `Windows VM - Omarchy`.
  * Close the RDP window → `RDP session closed. Stopping Windows VM...` / `Windows VM stopped.`
  * In a terminal type `omarchy-windows-vm status` → `Windows VM is stopped (status: exited)`; `omarchy-windows-vm launch -k`, close RDP → `Windows VM is still running.`; `omarchy-windows-vm status` → the `Windows VM Status: RUNNING` box; `omarchy-windows-vm stop` → `Windows VM stopped.`
  * Menu → Remove → Windows → **Yes** → `Windows VM removal completed!`; Apps → `windows` → gone; `ls -d ~/.windows ~/.config/windows 2>&1` → both `No such file`.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Each privileged step prompts polkit unless sudoless Docker is enabled.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The configuration box, the progress URL, the RDP window with the expected title, the status outputs, the removal message
  * If unsuccessful
  ** The `❌ Failed to start Windows VM!` block and `omarchy-windows-vm status` output
covers: bin/omarchy-windows-vm (install/launch/stop/status/remove); test/shell.d/windows-vm-test.sh; test/shell.d/windows-vm-compose-test.sh; manual/28-windows-vm.md
merged-from: 23:windows-vm-full-install-launch-remove

## Moved to other domains

- 11:install-webapp-interactive-and-remove → B — the Install → Web App wizard → launcher → open → Remove → Web App user story; B owns it (only the CLI machinery stays here).
- 22:webapp-install-interactive-happy-path → B — same menu-driven web-app user story.
- 22:webapp-remove-via-menu-and-cli → B — Remove → Web App picker plus the Super+Shift+Y chord staying independent of the launcher entry; the unknown-name CLI negative it carries is folded into this domain's web-app machinery test from 01-FACTS.
- 22:launch-tui-focus-instead-of-duplicate → B — `omarchy-launch-or-focus-tui` focusing an existing btop is launch behaviour, not install/remove.
- 40:hypr-launch-tui-utilities-btop-calc-cliamp → B — Super+Ctrl+T / Super+Ctrl+Q / Super+Shift+Alt+M launch chords and their window rules.
- 22:launch-docker-tui-polkit-gate → B — Super+Shift+D launching lazydocker behind the polkit dialog; nothing is installed or removed.
- 40:hypr-launch-docker-tui-polkit → B — same Docker TUI launch story.
- 41:docker-tui-polkit-prompt → B — same Docker TUI launch story (wrong-password variant).
- 13:sshd-setup-paste-key-then-remove → H — sshd hardening (paste key, key-only login, `ufw` 22 rule) is the security chapter H already holds the exact strings for (`sshd -T`, `22/tcp LIMIT`).
- 42:provisioning-state-clean-on-installed-disk → H — OS-installer provisioning invariants on the minted disk (`/var/lib/omarchy/provisioning`, `omarchy-provision-owner` no-op), not app install machinery.
- 42:install-log-and-timing-clean → H — the ISO installer's unified log and phase timing left on the target; a system invariant.
- 42:mise-node-offline-bundle → H — install-time Node bundle / mise pin / stubs contract; note `mise settings get upgrade.auto_prune` → `false` is set by a 4.0.4 migration and may not hold on a pristine 4.0.2 disk.
- 61:provisioned-install-invariants → H — `$OMARCHY_PATH`, first-run user units, done markers, `omarchy provision user` no-op: provisioning contract, not the Install menu.
- 13:mac-install-and-known-limitations → I — Apple-hardware install path; VM-NO and installer-only.
- 42:install-free-space-too-small-offers-partition-tool → I — ISO configurator free-space path; needs a fresh ISO start with a fixture disk.
- 42:install-too-small-disk-fails-cleanly → I — ISO installer ENOSPC failure screen; needs a fresh ISO start with an 8 GiB disk.
- 30:bar-add-and-remove-widgets → D — `omarchy bar put` / `plugin enable|disable` of shipped widgets is bar layout, not plugin install/remove.
- 31:plugins-enable-and-disable-tailscale-dropbox → D — Setup → Plugins enable/disable of shipped panels and their missing-CLI panel texts; bar/panel behaviour.
- 11:cliamp-music-tui-without-audio → F2 — Cliamp in use (UI, `?` help, playback error without audio); the chord's or-focus half is B's.
- 60:omareel-install-and-launcher → F2 — the block's substance is the omareel launcher window and webcam toggle in use; the `omarchy pkg add` step is trivial and already covered by the pkg tests here.

## Dropped

(none)

## Rerouted

- 11:lazydocker-polkit-prompt → B — the Super+Shift+D Docker TUI launch behind the polkit dialog; F1 already moved its three siblings (22:launch-docker-tui-polkit-gate, 40:hypr-launch-docker-tui-polkit, 41:docker-tui-polkit-prompt) to B, where the story should be merged once.
- 42:firstrun-force-rerun-toasts → H — `omarchy-provision-first-run --force` replays user provisioning; F1 moved every other 42/61 provisioning invariant (42:provisioning-state-clean-on-installed-disk, 42:install-log-and-timing-clean, 42:mise-node-offline-bundle, 61:provisioned-install-invariants) to H and this belongs with them.
- 42:firstrun-offline-shows-wifi-toast → H — first-run `wifi.sh` / `nm-online` provisioning logic (Wi-Fi vs Update toast); same provisioning family as above, not app install/remove machinery.
