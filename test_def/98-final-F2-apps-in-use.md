# Apps in use — final tests

This domain covers the applications a user opens and works in on a stock Omarchy desktop: Chromium
as the host for the web-app chords, launcher entries and `mailto:`/`zoommtg:` handlers; the
editor/tmux/herdr launch chords and Obsidian's launch-or-focus; the shell tools the manual teaches
(rg, fd, bat, tldr, yt-dlp, try, dua); Herdr with Omarchy's `Ctrl+Space` prefix; the shipped omacom
apps (omacalc, omawrite, omacut, ttfx) and the installable ones (omasnap, omareel, the elsewhen and
port-forward plugins); plus `omarchy openclaw onboard` on a disk without OpenClaw. 55 source blocks
plus 14 routed in from B, C, E, F1, G1, G2, D and H → 37 tests and 3 not-runnable entries; 10 blocks
moved (power widget/battery absence, oomd, resolved, plugin URL guards, gaming installers, speaker
tuning, unshipped plans) to the domains that hold their same-story siblings; nothing dropped or
rerouted. The routing pass folded 7 blocks into existing tests (mailto/zoommtg handlers, Obsidian
focus, the preinstalled web-app chords, Disk Usage, OpenClaw launch, herdr CLI help, the omareel
launcher) and added 7 tests (Cliamp, the eight-app GUI launcher sweep, PDF fill with Xournal++, imv
bindings, WhatsApp Slim, the notification-center plugin, omarchy-audio-tuner). Notable merges: four web-app hotkey blocks (40, 11×2, 10) into
one chord tour with focus reuse, the YouTube opacity tag, the Incognito browser and the
ChatGPT-not-in-launcher check; two Herdr session blocks (60, 11) into launch/detach/re-attach/stop;
the three power-profile blocks (12, 24, 52) into one CLI test kept here because no other domain holds
a sibling — likewise `omarchy-system-stats` and the generic `omarchy-toggle` primitive. Several apps
the domain brief names (lazygit, btop, Signal/Spotify/1Password chords, default-agent picking,
kitty/alacritty/ghostty, Nautilus, imv/mpv, xournalpp) had no block in this slice; their proposals sit
in H and F1. Blocks from file 11 were normalised (5–9 steps, `**` caveats, hints, closing bullets,
round trip). Herdr, ttfx and the org apps are HEAD-era on a 4.0.2 mint: every such test tells the
driver to report "absent on this build" rather than "broken". Chromium/Electron apps may raise
Hyprland's "not responding" dialog (click **Wait**); GTK dialogs and Files render oversized at 1×
(expected). `03-INTENDED-BEHAVIOUR.md` was applied in the routing pass: the only verdicts touching this
domain are #23 (hype README, DEFECT — the not-runnable entry asserts `omarchy pkg add hype` → `target
not found`, exit 1) and #24 (elsewhen package path, UNCLEAR — the driver records `omarchy version`);
A1 (Defaults → Browser), A2 (Signal chord) and #29 (1Password Remove row) have no test in this file —
their blocks live in F1 — and the Cliamp test only warns the driver off the Signal/Spotify-style
install-on-chord. Where the manual and the code disagree (ChatGPT/Grok have hotkeys but no launcher
row) the code's behaviour is asserted.

## Tests

### webapp-hotkeys-open-app-windows-and-focus-reuse   [VM-OK] [NET]
description: The web-app chords open their sites as frameless Chromium app windows (no tab strip or address bar); chords declared with focus reuse their window from another workspace instead of duplicating, YouTube loses the browser opacity tag, Super+Shift+Alt+B opens a full Incognito browser, ChatGPT/Grok have no launcher row, and a non-URL does not crash the launcher.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Shift+A. A Chromium app window without tab strip or address bar loads `chatgpt.com` (landing or login page; a network error page still counts as the window). Press Super+Shift+A again: a **second** ChatGPT window opens (this chord has no focus flag). Close both with Super+W.
  ** Chromium on 2 vCPU can raise Hyprland's "not responding" dialog: click **Wait**, do not report a hang. Pages take 10–20 s over the VM's NAT; keep screenshotting.
  * Press Super+Shift+P (Google Photos, sign-in page). Press Super+Shift+P again on the same workspace: still one Photos window. Press Super+3, then Super+Shift+P again: you are brought back to the existing Photos window on workspace 1, no second window. Press Super+Return and type `hyprctl clients | grep -c 'photos.google.com'` Enter → `1`. Close Photos with Super+W and keep the terminal.
  ** Two app windows would tile side by side; a single window fills the workspace — that is the quick visual check before the count.
  * Press Super+Shift+Y (YouTube). In the terminal type `hyprctl clients | grep -A30 'youtube' | grep tags` Enter → no `chromium-based-browser`, no `default-opacity` (video is never dimmed). Close YouTube.
  * Press each remaining chord in turn, confirm an app window for the named site appears (login pages, cookie banners and bot checks are fine; the site in the window title is the check), screenshot it and close it with Super+W before the next: Super+Shift+Alt+A (`grok.com`), Super+Shift+E (`app.hey.com` sign-in), Super+Shift+Alt+E (`app.hey.com/messages/new…`, sign-in redirect acceptable), Super+Shift+C (`app.hey.com/calendar/…`), Super+Shift+Alt+G (`web.whatsapp.com` QR/sign-in — press it a second time from the terminal: the same single window is focused, still **one** WhatsApp window), Super+Shift+Ctrl+G (Google Messages), Super+Shift+S (Google Maps — a map or consent page), Super+Shift+X (`x.com`), Super+Shift+Alt+X (`x.com/compose/post`, login wall acceptable).
  ** Super+Shift+S is Maps here, not a screenshot. When in doubt, `hyprctl activewindow | grep -i title` in the terminal names the site.
  * Press Super+Shift+Alt+B: a separate **Incognito** browser window ("You've gone Incognito") opens — a full browser with a tab strip, unlike the app windows. Close it.
  * Press Super+Alt+Space (Apps) and type `ChatGPT`: **no** application row is found — ChatGPT and Grok are hotkey-only web apps with no `.desktop` entry. Press Escape.
  ** Searching from the root menu (Super+Space) instead matches *Install → AI → ChatGPT Desktop*, which is a menu row, not a launcher.
  * Unhappy path: in the terminal type `omarchy-launch-webapp 'not a url'` Enter → a Chromium error/search page or a printed error, no crash. Close whatever opened, then close the terminal with Super+W; the desktop is empty as at the start.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Super+Shift+Alt+B is `<M-S-A-b>`; the Ctrl chord for Messages is `<M-S-C-g>`.
  * Each page is 1–3 MB; wait for the window, not for the page to finish. The window opening at the right domain is the pass condition.
  * Web-app windows are Chromium `--app=` windows; the focus variant matches the description text ("Google Photos") against the window class/title.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the ChatGPT app window and its duplicate, being pulled back to Photos with a single window and the `1` count, the YouTube tags line without the browser tags, one screenshot per remaining web app showing its site, one WhatsApp window after the second press, the Incognito window with its tab strip, the empty Apps search for ChatGPT, and the bad-URL result
  * If unsuccessful
  ** Screenshot of a normal tabbed browser window instead of an app window, a duplicated Photos/WhatsApp window, or a chord with no window; `hyprctl clients | grep -E 'class|title|tags' | sudo tee /dev/ttyS0` read via get-serial
covers: default/hypr/bindings/applications.lua:7,22-33; default/hypr/helpers.lua:67-72; default/hypr/apps/browser.lua:2-9; bin/omarchy-launch-webapp; bin/omarchy-launch-or-focus-webapp; bin/omarchy-launch-or-focus; bin/omarchy-launch-browser; manual/07:103,110-125; manual/25-web-apps.md:17-63
merged-from: 40:hypr-launch-webapps; 11:webapp-hotkeys-hey-chatgpt-grok; 11:webapp-hotkeys-google-x-youtube; 10:webapp-hotkeys-and-private-browser; 22:preinstalled-webapp-chords-and-focus

### webapp-launch-cli-chromeless-and-or-focus   [VM-OK] [NET]
description: `omarchy-launch-webapp <url>` opens a chromeless Chromium app window, `omarchy-launch-or-focus-webapp` re-focuses that window instead of opening another, a plain relaunch does open a second one, and the or-focus helper refuses to run without arguments.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter and type `omarchy-launch-webapp https://example.com` Enter.
  ** A Chromium window with no tab strip or address bar shows example.com (an offline error page still counts for the window-shape check). Click **Wait** if Hyprland's "not responding" dialog appears.
  * Click the terminal and type `omarchy-launch-or-focus-webapp example.com https://example.com` Enter.
  ** Focus returns to the same window; still exactly one web-app window on screen.
  * Click the terminal and type `omarchy-launch-webapp https://example.com` Enter.
  ** A second web-app window opens. Close both with Super+W.
  * In the terminal type `omarchy-launch-or-focus-webapp; echo "exit=$?"` Enter.
  ** A usage line and `exit=1`; nothing opens.
  * Close the terminal with Super+W; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Page load is a few KB; offline is fine for the window-shape check.
  * The or-focus helper matches its first argument against the window class/title, so `example.com` is the key it looks for.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the chromeless window; one window after or-focus; two after the plain relaunch; the usage line with `exit=1`
  * If unsuccessful
  ** Screenshot showing a tabbed browser instead of app mode, a duplicate after or-focus, or a terminal error
covers: bin/omarchy-launch-webapp; bin/omarchy-launch-or-focus-webapp; default/hypr/apps/browser.lua
merged-from: 22:launch-webapp-chromeless-window

### webapp-launcher-entries-open-app-windows   [VM-OK] [NET]
description: The seeded web-app launchers (YouTube, Google Maps, Basecamp, Discord, Zoom, Google Contacts, HEY, X, WhatsApp, Google Messages/Photos) appear in the Apps menu with icons and open as Chromium app windows; an unknown search yields no results without an error.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Alt+Space and type `You`.
  ** **YouTube** is listed with its icon. Press Enter: a Chromium app window (no tabs or address bar) loads youtube.com. Press Super+W.
  * Press Super+Alt+Space, type `Maps`, Enter → Google Maps app window. Press Super+W.
  * Press Super+Alt+Space, type `Basecamp`, Enter → app window on the 37signals launchpad sign-in (`launchpad.37signals.com`). Press Super+W.
  * Repeat for `Discord` (discord.com login), `Zoom` (`app.zoom.us/wc/home`) and `Google Contacts` (Google sign-in), closing each with Super+W.
  ** Chromium may raise the "not responding" dialog on 2 vCPU: click **Wait**.
  * Press Super+Alt+Space and look through the list (scroll if needed): rows for HEY, X, WhatsApp, Google Messages and Google Photos are also present. Screenshot the list, then press Escape.
  * Press Super+Alt+Space, type `zzqx` → no results, no error. Press Escape.
  * Press Super+Return and type `ls ~/.local/share/applications/` Enter → the same set of `.desktop` files (Basecamp, Discord, Disk Usage, Docker, Google Contacts/Maps/Messages/Photos, HEY, WhatsApp, X, YouTube, Zoom). Close the terminal with Super+W; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Pages load slowly through NAT; wait up to 15 s with repeated screenshots.
  * The Zoom and YouTube app windows are configured opaque; the others carry slight transparency.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the launcher entry with icon, the YouTube, Maps, Basecamp, Discord, Zoom and Contacts app windows, the Apps list with the remaining rows, the empty `zzqx` search, and the `ls` output
  * If unsuccessful
  ** Screenshot of a full browser (tabs) opening instead of an app window, a missing launcher row, or the `ls` output lacking a file
covers: applications/*.desktop; applications/icons/*; bin/omarchy-launch-webapp; manual/25-web-apps.md:23-27,49-51,65-75; docs/file-layout.md:89; default/hypr/apps/browser.lua:8-9
merged-from: 41:webapp-desktop-entries-launch; 11:webapp-launcher-entries

### webapp-handlers-mailto-zoommtg-and-unknown-scheme   [VM-OK] [NET]
description: The HEY and Zoom launchers register themselves as the `mailto:` and `zoommtg:` scheme handlers, so `mailto:` links open HEY's compose page and `zoommtg:` links open Zoom's web-client join page in chromeless windows, while an unknown scheme yields an xdg-open error rather than a chooser.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter and type `xdg-mime query default x-scheme-handler/mailto; xdg-mime query default x-scheme-handler/zoommtg` Enter → `HEY.desktop` and `Zoom.desktop`.
  * Type `xdg-open 'mailto:test@example.com?subject=Hi'` Enter.
  ** A chromeless window opens on `app.hey.com` (after the sign-in redirect its URL targets `app.hey.com/messages/new?to=test@example.com`; a HEY sign-in page is acceptable). Click **Wait** on a "not responding" dialog.
  * With the HEY window focused press Alt+Shift+L, then click the terminal and type `wl-paste; hyprctl clients | grep -i 'title:'` Enter.
  ** The copied URL is on `app.hey.com` and a title line names HEY. Click the web window and close it with Super+W.
  * In the terminal type `xdg-open 'zoommtg://zoom.us/join?confno=1234567890&pwd=abc'` Enter.
  ** A chromeless Zoom window opens at `app.zoom.us/wc/join/1234567890?pwd=abc` (Zoom's web-client join page, possibly saying the meeting is invalid — the URL is what matters); no "no application" dialog. Read the URL the same way (Alt+Shift+L, `wl-paste`) and the `hyprctl clients` title naming Zoom. Close the window.
  * Type `omarchy-webapp-handler-zoom` Enter (no argument).
  ** A Zoom window at `app.zoom.us/wc/home` opens. Close it.
  * Type `xdg-open 'notascheme://x'; echo "exit=$?"` Enter → an xdg-open error, a non-zero exit, nothing opens (no "Open with" chooser).
  * Close the terminal with Super+W; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * App-mode windows show no address bar: the window title (from hyprctl), the page content and the Alt+Shift+L copy are the only places the target URL shows.
  * Sites may show login pages; only the host and path matter.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of both `xdg-mime` answers, the HEY window with its copied URL, the Zoom join window with its URL and Zoom's home, the terminal title lines naming HEY and Zoom, and the unknown-scheme error with its exit code
  * If unsuccessful
  ** Screenshot of Chromium opening the raw `mailto:`, an "Open with" chooser, the wrong page, or a terminal error; `cat ~/.config/mimeapps.list | sudo tee /dev/ttyS0` read via get-serial
covers: bin/omarchy-webapp-handler-hey; bin/omarchy-webapp-handler-zoom; applications/HEY.desktop; applications/Zoom.desktop; default/applications/mimeapps.list (mailto, zoommtg); manual/25-web-apps.md:17-21,65-69
merged-from: 22:webapp-handlers-mailto-and-zoom; 41:mailto-and-webapp-handlers; 11:mailto-and-zoom-handlers

### webapp-copy-url-and-download-shortcuts-listed   [VM-PARTIAL] [NET]
description: The Copy URL and Download Video shortcuts for web apps are advertised in the keybindings viewer and send their chord to the focused web app when picked; the yt-dlp download itself is skipped, the "URL copied" toast is the observable half.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+K and type `Web App`.
  ** Rows `SHIFT ALT + L → Copy URL from Web App` and `SHIFT ALT + D → Download Video from Web App`. Press Escape.
  * Press Super+Shift+Y and, with the YouTube window focused, press Shift+Alt+L.
  ** If the bundled Chromium extension is active a toast "URL copied to clipboard" appears; otherwise nothing. Record which. Click **Wait** on a "not responding" dialog.
  * Press Super+K, type `Copy URL`, Enter.
  ** Same outcome as the direct chord.
  * Press Super+Enter and type `wl-paste` Enter.
  ** Report the clipboard content (a `https://www.youtube.com/…` URL when the extension is active).
  * Close the terminal and the YouTube window with Super+W; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Skipped: the yt-dlp download itself (needs a real video and time); the toast is the observable half.
  * The viewer is a fuzzy picker; typing filters live.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the two rows; the toast or an explicit note of its absence; the `wl-paste` output
  * If unsuccessful
  ** Screenshot of the viewer missing the rows, or the chord crashing the web app
covers: bin/omarchy-menu-keybindings (static_bindings/dispatch_sendshortcut_binding); bin/omarchy-chromium-copy-url-host; bin/omarchy-chromium-ytdlp-host
merged-from: 22:chromium-webapp-shortcuts-listed

### launch-chords-neovim-tmux-herdr-and-cheatsheets   [VM-OK]
description: Super+Shift+N opens Neovim in a tiled terminal, Super+Alt+Return attaches to the "Work" tmux session (re-attaching rather than duplicating), Super+Ctrl+Return opens Herdr, and Super+Alt+K / Super+Ctrl+K show the tmux and Herdr keybinding sheets.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Shift+N: a terminal with the Neovim (LazyVim) dashboard opens, tiled like a normal window, not floating. Type `:q` Enter to close it.
  ** First Neovim start loads plugins for several seconds; wait for the dashboard.
  * Press Super+Alt+Return: a terminal with a tmux status bar (session "Work") opens. Type `echo INSIDE-TMUX` Enter, then press Super+Alt+Return again: a second terminal attached to the same session shows INSIDE-TMUX too. Close both with Super+W; in a new terminal (Super+Enter) run `tmux kill-server`.
  * Press Super+Alt+K: a viewer listing tmux bindings (Prefix + v "Split pane beside", Alt + Enter …). Press Escape.
  * Press Super+Ctrl+Return: a terminal running Herdr (a tab bar with one tab, the hostname on the right) opens. Press Ctrl+Space then `d` to detach (the window closes); in the terminal run `herdr server stop`.
  ** Herdr chords are newer than 4.0.2: if Super+K has no "Herdr" row on this build, report them absent, not broken.
  * Press Super+Ctrl+K: a viewer listing Herdr bindings, first row `PREFIX → CTRL + SPACE`. Press Escape.
  * Close the remaining terminal with Super+W; the desktop is empty.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If Ctrl+Space appears to do nothing in Herdr it may be swallowed by the fcitx5 input method; close the window with Super+W instead and still run `herdr server stop`.
  * The tmux session is persistent: killing the server is what returns the machine to its stock state.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the Neovim dashboard tiled, the tmux status bar, the second terminal showing INSIDE-TMUX, the tmux sheet, Herdr, and the Herdr sheet
  * If unsuccessful
  ** Screenshot of a terminal error (command not found) or an empty viewer after the chord
covers: default/hypr/bindings/applications.lua:8,12-13; default/hypr/bindings/utilities.lua:11-12; bin/omarchy-launch-editor; bin/omarchy-launch-terminal-tmux; bin/omarchy-launch-terminal-herdr; test/acceptance.d/apps-test.sh:39; manual/07:3,100-101,109,214
merged-from: 40:hypr-launch-editor-tmux-herdr-and-cheatsheets

### obsidian-launch-or-focus-single-window   [VM-OK]
description: Super+Shift+O opens Obsidian and a second press — from a terminal or from another workspace — re-focuses the existing window instead of starting another copy (the `focus` rule on that binding); a vault can be created and its Appearance settings reached; Super+Shift+W opens Omawrite as its own window.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Shift+O: Obsidian opens (software rendering; allow 15–20 s) showing its vault chooser ("Create new vault" / "Open folder as vault") or a previously opened vault.
  ** Electron apps take up to 20 s here; click **Wait** on a "not responding" dialog.
  * Press Super+Return to open a terminal (focus moves to it), then press Super+Shift+O again: focus returns to the **same** Obsidian window. In the terminal type `hyprctl clients | grep -ci 'class: obsidian'` Enter → `1`.
  * Press Super+2: an empty workspace 2 is shown (the bar's workspace indicator moves).
  * Press Super+Shift+O again: you are taken back to workspace 1 with the same Obsidian window focused and there is still exactly one Obsidian window.
  ** Two windows would tile side by side; one fills the workspace.
  * In Obsidian create a vault named `probe` in the default location (Create new vault → name → Create): the editor view appears. Open Settings (gear) → Appearance and confirm a theme dropdown exists; report whether `Omarchy` is listed.
  ** The vault-location dialog is a GTK/portal file chooser and renders oversized at 1× — expected.
  * Press Super+Shift+W: Omawrite opens as its own window.
  * Close Obsidian, Omawrite and the terminal with Super+W (in the terminal first `rm -rf ~/probe` — the vault folder created in the default location — if it exists); the desktop is empty.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Obsidian's first-run vault dialog is fine; the window class is what the focus rule matches.
  * Electron apps may print GPU warnings in the journal; they are not failures.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of Obsidian's first screen, the `1` from the client count after the second chord, being pulled back to it from workspace 2 with a single window, the Appearance settings, and Omawrite
  * If unsuccessful
  ** Screenshot of a second Obsidian window (duplicate launch) or nothing opening after a chord; `journalctl --user -n 30 | sudo tee /dev/ttyS0` read via get-serial
covers: default/hypr/bindings/applications.lua:18-19; bin/omarchy-launch-or-focus; default/hypr/helpers.lua:63-64,135-137; test/shell.d/hyprland-focus-app-test.sh; manual/07:121-122; manual/22-guis.md:11-19
merged-from: 40:hypr-launch-obsidian-omawrite-focus; 11:obsidian-hotkey-single-window

### disk-usage-dua-floating-tui   [VM-OK]
description: The "Disk Usage" launcher entry opens dua in interactive mode on `/` in a floating terminal so a user can find what fills the disk, navigate into a directory, read the help and quit cleanly.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Alt+Space, type `Disk`, and press Enter on **Disk Usage**.
  ** A floating, centred terminal (class `TUI.float`) opens running `dua i /`: after the scan (a few seconds, up to 10–30 s) it lists top-level directories (`usr`, `home`, `var`, …) with sizes, largest first.
  ** A tiled (edge-to-edge) window instead of a floating one means the `TUI.float` app-id was not applied; report it.
  * Press Down twice, then Enter (or `o`) on `usr` to descend; the listing shows its children. Press `u` (or Backspace) to go up.
  * Press `?`: dua's help overlay. Press Escape.
  * Press `q` (confirm with `y`/Enter if asked `Really quit?`); the window closes.
  * Press Super+Return and type `dua --version` Enter → `dua 2.x`. Close the terminal with Super+W; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Do **not** press `d` (mark for deletion) or Shift+D.
  * The floating TUI window is centred; the Apps menu is the only launcher for it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the floating dua window with `/` entries sorted by size, inside `usr`, the help overlay, and `dua 2.x`
  * If unsuccessful
  ** Screenshot of the window after launch (a tiled window, an empty terminal, `dua: command not found`, or a permission error)
covers: manual/21-tuis.md:37-39; applications/Disk Usage.desktop; applications/icons/Disk Usage.png; install/omarchy-base.packages (dua-cli); default/hypr/apps/system.lua:7-9 (TUI.float)
merged-from: 11:disk-usage-dua; 41:disk-usage-desktop-entry

### shell-tools-rg-fd-bat   [VM-OK]
description: rg, fd and bat are present and behave as the shell-tools chapter describes, including their failure modes (no match, missing file).
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return and type `mkdir -p /tmp/rt/app && cd /tmp/rt && echo 'class UsersController' > app/users_controller.rb && echo 'x' > person.rb` Enter.
  * Type `rg Controller app/` Enter → `app/users_controller.rb` with line `1:class UsersController` highlighted. Type `rg Nothing app/; echo rc=$?` Enter → no output, `rc=1`.
  * Type `fd person.rb` Enter → `person.rb`. Type `fd missing.rb; echo rc=$?` Enter → no output, `rc=0` (no match is not an error for fd).
  * Type `bat person.rb` Enter → a framed view with the file name header and line number `1`. Type `bat nope.rb` Enter → `[bat error]: 'nope.rb': No such file or directory (os error 2)`.
  * Type `man rg` Enter → a coloured page; press `q`.
  * Type `cd && rm -rf /tmp/rt` Enter and close the terminal with Super+W; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * All three tools are in the base package set; a `command not found` is a real failure.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the rg hit, `rc=1`, the fd results with `rc=0`, the bat frame, the bat error line, and the man page
  * If unsuccessful
  ** Screenshot of the deviating output
covers: manual/19-shell-tools.md:21-45; install/omarchy-base.packages (ripgrep, fd, bat)
merged-from: 11:ripgrep-fd-bat-tools

### shell-tools-tldr-and-yt-dlp   [VM-PARTIAL] [NET]
description: `tldr <cmd>` fetches its page cache on first run and shows examples, and `yt-dlp` is present and rejects a non-URL cleanly; an actual download is not attempted (YouTube throttles datacenter IPs).
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return and type `tldr tar` Enter.
  ** On first run it may print that it is downloading/updating the page cache (allow 30 s), then a short list of `tar` examples such as `tar cf path/to/target.tar`.
  * Type `tldr no-such-command-xyz` Enter → a message that no page was found (wording per client) — not a crash.
  * Type `yt-dlp --version` Enter → a date-style version like `2026.xx.xx`.
  * Type `yt-dlp not-a-url` Enter → `ERROR: [generic] not-a-url: … is not a valid URL` (or similar "not a valid URL").
  * Type `echo ${OMARCHY_YTDLP_DIR:-unset}; ls -d ~/Videos` Enter → `unset` and `/home/prime/Videos` (the default download folder for the browser extension).
  * Close the terminal with Super+W; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Skipped here: a real video download (the browser path is the Alt+Shift+D extension test).
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the tar examples, the not-found message, the yt-dlp version, the invalid-URL error, and the `unset` / `~/Videos` lines
  * If unsuccessful
  ** Screenshot of the failing command output
covers: manual/19-shell-tools.md:47-55; install/omarchy-base.packages (tldr, yt-dlp); bin/omarchy-chromium-ytdlp-host:18
merged-from: 11:tldr-and-yt-dlp

### try-experiment-directories   [VM-OK]
description: `try` is wired to `~/Work/tries` (created at provision) and creates date-stamped experiment directories, as the shell-tools chapter says; the bare `try` lists them.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return and type `ls -d ~/Work ~/Work/tries` Enter → both paths exist.
  * Type `type try` Enter → `try is a function` (the lazy wrapper). Type `try --help` Enter → try's usage text mentioning the tries directory.
  * Type `try omarchy-probe` Enter. try creates and switches into a new directory; `pwd` Enter shows `/home/prime/Work/tries/<date>-omarchy-probe` (date prefix format per try).
  ** If `try omarchy-probe` prompts to create the directory, confirm with Enter.
  * Type `try` Enter with no argument: try's interactive picker/list shows the directory just created; press Escape (or `q`) to leave.
  * Type `cd && rm -rf ~/Work/tries/*omarchy-probe*` Enter to clean up, then close the terminal with Super+W; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The picker may not filter on typing; navigate with arrows and leave with Escape.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the `ls -d` line, `try is a function`, the help, the `pwd` inside the dated directory, and the picker
  * If unsuccessful
  ** Screenshot of the failing command output
covers: manual/19-shell-tools.md:57-59; default/bash/init:13-19; install/user/mise-work.sh:2-3
merged-from: 11:try-experiment-directories

### herdr-launch-detach-reattach-and-stop   [VM-OK]
description: Super+Ctrl+Return opens Herdr's persistent terminal session; both detaching with Omarchy's `Ctrl+Space` prefix and closing the window keep the session, pressing the chord again returns to the same tabs and shell state, and the server can be stopped.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Ctrl+Return.
  ** A terminal opens running Herdr: a tab bar with one tab and a shell pane; the hostname appears on the right of the tab bar and the window title shows the hostname and a workspace name.
  ** Herdr chords are newer than 4.0.2: if nothing opens, run `pacman -Q herdr` and `omarchy version` in a terminal and report "absent on this build".
  * In the pane type `export HMARK=kept; echo HERDR-MARK-1` Enter. Press Ctrl+Space, release, then `c`: a second tab appears. Press Alt+1 to return to the first tab.
  * Press Ctrl+Space, release, then `d`.
  ** Herdr detaches and the terminal window closes.
  * Press Super+Ctrl+Return again.
  ** Herdr re-attaches with **two** tabs still present and the pane still shows `HERDR-MARK-1`; type `echo $HMARK` Enter → `kept`.
  * Close the Herdr window with Super+W (the session survives). Open a plain terminal with Super+Enter and run `herdr status server --json`.
  ** JSON with `"running": true`.
  * Run `herdr server stop`, then `herdr status server --json` again, and close the terminal with Super+W.
  ** The status reports not running; the desktop must return exactly as left.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The Omarchy prefix is Ctrl+Space (not the upstream Ctrl+b); detach is prefix then `d`, tabs are Alt+1..9. If Ctrl+Space appears to do nothing it may be swallowed by the fcitx5 input method — press Alt+Enter: a split proves Herdr is fine and the prefix is the problem; report either way.
  * `h` in a plain terminal is an alias for `herdr` and attaches to the same session.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of Herdr's first screen with one tab, then with two tabs
  ** Screenshot after re-attach showing two tabs, `HERDR-MARK-1` and `kept`
  ** Screenshot of the running-true and not-running status outputs
  * If unsuccessful
  ** Screenshot after the chord; `pacman -Q herdr`, `herdr --version`, `omarchy version`
covers: default/hypr/bindings/applications.lua:13; bin/omarchy-launch-terminal-herdr; config/herdr/config.toml [keys]; manual/21-tuis.md:25-29; manual/20-shell-functions.md:24; default/bash/aliases:53; default/hypr/bindings/utilities.lua:12; bin/omarchy-menu-herdr-keybindings; migrations/1786273938.sh
merged-from: 60:herdr-launch-detach-reattach; 11:herdr-session-and-keybindings

### herdr-keybindings-menu-and-cli-help   [VM-OK]
description: Super+Ctrl+K and Learn → Herdr show the Herdr keybinding menu built from Omarchy's shipped config, with the `Ctrl+Space` prefix on top and live filtering; the `--print` form works from a terminal and falls back to Herdr's built-in prefix when the config is missing; the herdr CLI the menu is built from prints its help, version and default config and rejects an unknown subcommand instead of hanging.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Ctrl+K.
  ** A searchable "Herdr keybindings" menu opens; the first row reads `PREFIX → CTRL + SPACE`, followed by rows such as `PREFIX + D → Detach`, `PREFIX + C → New tab` and `NAVIGATE + … → …`.
  ** If Super+K has no "Herdr" row on this build, report the chord absent on this build, not broken.
  * Type `detach`.
  ** The list filters to the Detach row. Press Enter: the picker closes without any action (display only).
  * Open the Omarchy Menu with Super+Space and click Learn, then Herdr, using the mouse.
  ** The same menu appears. Press Escape.
  * Open a terminal with Super+Enter and run `omarchy-menu-herdr-keybindings --print | head -5`.
  ** Rows print, the first with `CTRL + SPACE`.
  * Run `omarchy-menu-herdr-keybindings --print --config /nonexistent | head -3`.
  ** Rows still print, now with Herdr's built-in prefix (`CTRL + B`) — no error for a missing config.
  * Run `herdr --version; herdr --help | head -20`, then `herdr --default-config | grep -A3 '^# \[keys\]'`.
  ** A version (0.8.x or newer); usage text listing subcommands including `pane`, `tab`, `workspace`, `server`, `status`; a commented `[keys]` section with a `prefix` line — this is what the Super+Ctrl+K menu is built from.
  * Run `herdr definitely-not-a-command; echo "exit=$?"`.
  ** An error/usage message and a non-zero exit code; nothing hangs.
  * Close the terminal with Super+W.
  ** The desktop must return exactly as left.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The menu is a fuzzy picker; typing filters live.
  * An empty menu means `herdr --default-config` changed shape — capture `herdr --default-config | head -40 | sudo tee /dev/ttyS0` and read it with get-serial; the same trick reads `herdr --help` if it scrolls off screen.
  * If any herdr command shows nothing for 5 seconds, press Ctrl+C and report it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the menu with the PREFIX row, and filtered to Detach
  ** Screenshot of the Learn → Herdr path showing the same menu
  ** Screenshot of the two `--print` outputs, one with `CTRL + SPACE` and one with `CTRL + B`
  ** Screenshot (or serial capture) of `herdr --version`, `--help` and the `[keys]` excerpt, and the non-zero exit for the bad subcommand
  * If unsuccessful
  ** Screenshot of an empty menu or error; the command's stderr; serial capture of the default config head; the hang or crash with the exact command
covers: default/hypr/bindings/utilities.lua:12; default/omarchy/omarchy-menu.jsonc (learn.herdr-keybindings); bin/omarchy-menu-herdr-keybindings:29-33; bin/omarchy-restart-herdr; herdr README "install"
merged-from: 60:herdr-keybindings-menu; 22:herdr-keybindings-viewer; 60:herdr-cli-help

### herdr-split-tabs-with-omarchy-prefix   [VM-OK]
description: Omarchy's tmux-mirroring Herdr config makes the tmux muscle memory work: prefix+h/v split, prefix+c opens a tab without a name prompt, prefix+x closes without confirmation, prefix+? shows help.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Ctrl+Return to open Herdr.
  ** If nothing opens, `pacman -Q herdr` and report "absent on this build".
  * Press Ctrl+Space then `h`, then Ctrl+Space then `v`.
  ** Three panes: two side by side, one of them split top/bottom.
  * Press Ctrl+Space then `?`.
  ** A help overlay lists the active bindings; dismiss it with Escape.
  * Press Ctrl+Space then `c`.
  ** A second tab appears with a fresh pane and no name prompt.
  * Press Alt+Left, then Ctrl+Space then `x` twice.
  ** Back on the first tab, two panes close without confirmation, leaving one.
  * Press Ctrl+Space then `d`; in a terminal (Super+Enter) run `herdr server stop` and close the terminal with Super+W.
  ** The desktop must return exactly as left.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Release Ctrl+Space before pressing the action key. If the prefix is swallowed by the fcitx5 input method, Alt+Enter / Alt+Shift+Enter also split — note which path you used.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot with three panes
  ** Screenshot of the help overlay
  ** Screenshot with two tabs, then one pane left after closing
  * If unsuccessful
  ** Screenshot of an unexpected prompt/dialog or a key doing nothing; `cat ~/.config/herdr/config.toml`
covers: config/herdr/config.toml [keys], [ui]; manual/21-tuis.md "Herdr"
merged-from: 60:herdr-split-tabs-with-omarchy-prefix

### herdr-shell-layouts-hdl-hds-hsl   [VM-OK]
description: Omarchy's Herdr layout helpers refuse to run outside Herdr with a clear message; inside Herdr `hdl` builds an editor + AI + terminal layout and `hsl` tiles panes running a command, renaming the tab after the directory.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `hdl bash`, then `hdl`.
  ** `You must start herdr to use hdl.` and nothing else; then the usage line `Usage: hdl <c|cx|codex|other_ai> [<second_ai>]`.
  * Run `hds x; hds; hsl 2 bash`.
  ** `Usage: hds`, `You must start herdr to use hds.`, `You must start herdr to use hsl.`
  ** A "command not found" means the minted 4.0.2 predates that helper: record it as absent on this build.
  * Press Super+Ctrl+Return; in Herdr's pane run `mkdir -p ~/hdltest && cd ~/hdltest && hdl bash`.
  ** The tab is renamed `hdltest`; the layout becomes a large Neovim pane on the left, a `bash` pane on the right and a short terminal pane along the bottom.
  ** Neovim's first start may install plugins — wait for it.
  * In Neovim press Escape, type `:qa!` Enter.
  * Press Ctrl+Space then `c` for a fresh tab; run `cd /tmp && hsl 3 'echo herdr-$RANDOM'`.
  ** Three tiled panes each printing `herdr-<n>`; the tab is renamed `tmp`.
  * Press Ctrl+Space then `?` → the Herdr help overlay; press Escape.
  * Press Ctrl+Space then `d`; in the plain terminal run `herdr server stop; rm -rf ~/hdltest` and close it with Super+W.
  ** The desktop must return exactly as left.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * `hdl` normally starts an AI CLI in the right pane; `bash` is used so no login or network is needed.
  * If Super+Ctrl+Enter opens nothing, type `herdr` in the terminal; if it is not installed, mark the inside-Herdr steps "absent on this build".
  * If the Ctrl+Space prefix is swallowed by the input method, Alt+Enter splits — note it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the refusal and usage lines outside Herdr (hdl, hds, hsl)
  ** Screenshot of the three-pane `hdl` layout with the tab named hdltest
  ** Screenshot of the 3-pane `hsl` swarm with the tab named tmp, and of the help overlay
  * If unsuccessful
  ** Screenshot of a helper acting outside Herdr, an error, or Herdr crashing; `type hdl` output
covers: default/bash/fns/herdr (hdl, hds, hsl); config/herdr/config.toml; manual/20-shell-functions.md:24; test/shell.d/herdr-functions-test.sh
merged-from: 60:herdr-shell-layout-hdl; 41:herdr-layout-functions

### omacalc-floating-calculator   [VM-OK]
description: Omacalc, Omarchy's calculator on Super+Ctrl+Q, opens as a floating window over the tiled desktop and computes correctly from both the mouse keypad and the keyboard, including the percent convention, a harmless division by zero and copy to clipboard; Super+T toggles it tiled and it also launches from the Apps menu.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return so a tiled terminal exists, then press Super+Ctrl+Q.
  ** A small **floating** calculator window titled Omacalc appears centred over the terminal, with a display and a keypad (digits, × ÷ + −, %, ±, =).
  ** If nothing opens on the chord, run `pacman -Q omacalc` in the terminal and report the result instead of installing it.
  * Using the mouse only, click `4` `2` `×` `3` `+` `7` `=`.
  ** The result reads `133` and the expression `42 × 3 + 7` stays visible above it.
  * Press `C` on the keyboard, then type `200+10%=`.
  ** The result reads `220` (percent of the running total when + is pending).
  * Press `C`, then type `7/0=`.
  ** The display shows an error or a non-finite value; the window stays open and responsive.
  * Press `C`, type `12.5*4=`, press Ctrl+C, then click the terminal and type `wl-paste` Enter.
  ** The terminal prints `50`.
  * Click Omacalc and press Super+T: it tiles beside the terminal; Super+T again floats it. Close it with Super+W.
  * Press Super+Alt+Space, type `Omacalc`, Enter: it opens floating again. Close it and the terminal with Super+W.
  ** The desktop must return exactly as left.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The keypad is small; double-check the mouse position before each click — a mis-click on ± or % changes the result.
  * Keyboard operators are `*` and `/`; Enter also equals. Escape clears the display and may not close the window; use Super+W to close.
  * Omacalc's window class is `omacalc`; a window rule floats it. The XF86Calculator binding cannot be sent by the driver — ignore it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the floating Omacalc over the terminal showing `42 × 3 + 7` and `133`
  ** Screenshot showing `220`, and one showing the display after `7/0=` with the window still open
  ** Screenshot of the terminal printing `50`, of Omacalc tiled, and of the Apps-menu launch
  ** Screenshot of the restored desktop
  * If unsuccessful
  ** Screenshot of the wrong result, the vanished window, or the empty desktop after the chord; `pacman -Q omacalc omawrite` output
covers: default/hypr/bindings/utilities.lua:13-14; default/hypr/bindings/applications.lua:19; default/hypr/apps/system.lua:32,37; manual/22-guis.md:21-25,62-66 ("Omacalc", "Omawrite"); omacalc README "Usage"; test/shell.d/keybindings-menu-test.sh:104; install/omarchy-base.packages (omacalc, omawrite)
merged-from: 60:omacalc-calculate; 11:omawrite-and-omacalc-hotkeys

### omawrite-open-write-and-save   [VM-OK]
description: Omawrite on Super+Shift+W opens an empty Markdown editor within the acceptance suite's 45 s budget; typing and saving goes through the portal file picker, cancelling the picker keeps the text, the saved file holds what was typed, and the window closes cleanly.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Take a screenshot: no Omawrite window is open. Press Super+Shift+W.
  ** Within 45 seconds an Omawrite window opens: a plain writing surface in the theme colours, no toolbar clutter.
  ** If the hotkey does nothing, open a terminal with Super+Enter, type `omawrite &` Enter and allow the same 45 seconds; `pacman -Q omawrite` if still nothing.
  * Press Ctrl+? (Ctrl+Shift+/), look at the shortcut reference, then press Escape.
  ** The reference lists at least Ctrl+S, Ctrl+O, Ctrl+F, Ctrl+H.
  * Type `# VM test`, Enter, `Hello from the guest.`
  * Press Ctrl+S, then click Cancel in the file dialog.
  ** A floating GTK Save dialog appeared (it renders oversized at 1× — expected); after Cancel the text is still in the editor and the title still shows an unsaved/untitled document.
  * Press Ctrl+S again; in the dialog press Ctrl+L, type `~/Documents/vmtest.md`, Enter (confirm if asked).
  ** The title now shows `vmtest.md`.
  * Type Enter then `Third line.` and press Ctrl+S.
  ** No dialog this time.
  * Open a terminal with Super+Enter, run `cat ~/Documents/vmtest.md; rm ~/Documents/vmtest.md`, then close the terminal with Super+W.
  ** The three lines print exactly.
  * Press Super+W on Omawrite: within 30 seconds the window is gone and the desktop looks exactly as at the start.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Ctrl+L in the GTK dialog opens a path entry; `~` expands. If `~/Documents` is missing, `mkdir -p ~/Documents` in a terminal first.
  * Super+Shift+W launches rather than focuses — a second press opens a second window; close both. The acceptance suite matches the class `(?i)omawrite`.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the empty editor (within 45 s) and of the shortcut reference
  ** Screenshot of the Save dialog and of the intact text after Cancel
  ** Screenshot of the title bar showing vmtest.md
  ** Screenshot of `cat ~/Documents/vmtest.md` printing three lines, and of the desktop after the window closed
  * If unsuccessful
  ** Screenshot after 45 seconds with no window; the missing dialog, lost text, or wrong file contents; `pacman -Q omawrite`; terminal output if launched by command
covers: default/hypr/bindings/applications.lua:19; manual/22-guis.md "Omawrite"; omawrite README "Shortcuts"; default/hypr/apps/system.lua:16; test/acceptance.d/shell-surfaces-test.sh:99-117; test/acceptance.d/apps-test.sh:12-31,40
merged-from: 60:omawrite-write-and-save; 50:app-launch-omawrite

### omawrite-external-change-warning   [VM-OK]
description: When a file open in Omawrite is changed on disk while the editor holds unsaved edits (made with find/replace), Omawrite must warn and let the user keep their work instead of silently replacing it.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `mkdir -p ~/Documents && printf 'alpha beta\nalpha gamma\n' > ~/Documents/ext.md && omawrite ~/Documents/ext.md &` then Enter.
  ** Omawrite opens showing the two lines.
  * In Omawrite press Ctrl+H, enter find `alpha` and replace `omega`, apply to all matches. Do not save.
  ** Both lines now start with `omega`.
  * Click the terminal and run `echo 'changed outside' >> ~/Documents/ext.md`.
  * Click back into the Omawrite window and wait up to 5 seconds.
  ** A warning that the file changed on disk appears (banner or dialog) offering to reload or keep the local version; the `omega` text is still there.
  * Choose to keep the local version, then press Ctrl+S.
  * In the terminal run `cat ~/Documents/ext.md`.
  ** The two `omega` lines print.
  * Run `rm ~/Documents/ext.md`, then close Omawrite and the terminal with Super+W.
  ** The desktop must return exactly as left.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The warning may be a slim banner at the top or bottom edge of the editor rather than a dialog — look at both edges.
  * Use the mouse to switch windows so focus (which triggers the check) is unambiguous.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot after replace showing `omega`
  ** Screenshot of the external-change warning
  ** Screenshot of `cat ~/Documents/ext.md` with the two `omega` lines
  * If unsuccessful
  ** Screenshot showing the editor content replaced with no warning, or the replace dialog missing
covers: omawrite README (Ctrl+H; "watches open files and warns before an external change can replace local work")
merged-from: 60:omawrite-external-change-warning

### omacut-trim-and-export   [VM-OK]
description: Omacut, launched from the Apps menu, opens a video, lets the user set a trim range, asks before quitting with an un-exported trim, and exports a shorter MP4.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `ffmpeg -y -f lavfi -i testsrc=duration=6:size=640x360:rate=30 -pix_fmt yuv420p ~/Videos/test.mp4`; wait for the prompt to return.
  * Open the Apps menu with Super+Alt+Space, type `Omacut`, press Enter.
  ** Omacut opens with an empty player. Press `?` to see the hotkey list, then dismiss it. If nothing opens, `pacman -Q omacut` and report.
  * Press Ctrl+O; in the dialog press Ctrl+L, type `~/Videos/test.mp4`, Enter.
  ** The test pattern loads with a timeline and two trim handles. The GTK picker renders oversized at 1× — expected.
  * Press Space, wait 2 seconds, Space again, then Ctrl+Space; press Right twice, then Alt+Space.
  ** The highlighted range between the handles is about 2 seconds long.
  * Press Q.
  ** Omacut asks for confirmation because the trim is not exported. Choose to stay.
  * Press Ctrl+S; in the export dialog keep the default quality and save as `~/Videos/test-cut.mp4`.
  ** A progress indication runs and completes.
  * In the terminal run `ffprobe -v error -show_entries format=duration -of csv=p=0 ~/Videos/test-cut.mp4`, then press Q in Omacut.
  ** A duration between 1.5 and 3 seconds prints; Omacut quits without asking.
  * Run `rm ~/Videos/test.mp4 ~/Videos/test-cut.mp4` and close the terminal with Super+W.
  ** The desktop must return exactly as left.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * There is no chord for Omacut; the Apps menu is the only launcher.
  * Both dialogs are GTK portal pickers: Ctrl+L then a path works.
  * If ffmpeg complains about libx264, add `-c:v mpeg4` before the output path.
  * Ctrl+Space is also the fcitx5 input-method trigger; if the in-handle does not move, report it as the swallowed-prefix quirk, not an Omacut defect.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the hotkey overlay
  ** Screenshot of the loaded video with a highlighted trim range
  ** Screenshot of the quit confirmation on the un-exported trim
  ** Screenshot of ffprobe printing a ~2 s duration
  * If unsuccessful
  ** Screenshot of the failing step; `ls -la ~/Videos`; any crash dialog
covers: manual/22-guis.md "Omacut"; omacut README "Hotkeys"; bin/omarchy-install-preinstalls:25
merged-from: 60:omacut-trim-and-export

### ttfx-terminal-effect   [VM-OK]
description: ttfx, the terminal-effects binary behind the screensaver, animates piped text and settles on it, lists its effects in --help, and rejects an unknown effect with a usage error.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `ttfx --help | head -25`.
  ** The usage header and the start of the effect list (beams, binarypath, blackhole …) print. A `command not found` → `pacman -Q ttfx`; report "absent on this build".
  * Run `printf 'OMARCHY VM TEST\nline two\n' | ttfx decrypt`.
  ** A decrypt animation plays for a few seconds and ends with the two lines legible; the prompt returns.
  * Run `printf 'hello\n' | ttfx --random-effect`.
  ** Some effect plays and ends with `hello`.
  * Run `printf 'x\n' | ttfx nosucheffect; echo "exit=$?"`.
  ** An error naming the unknown effect and a non-zero exit (expected `exit=2`).
  * Close the terminal with Super+W.
  ** The desktop must return exactly as left.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Take a screenshot mid-animation as well as after it settles.
  * If the terminal is left garbled after a run, type `reset` Enter and report it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the `--help` head
  ** Mid-animation and final screenshots of the decrypt run, and the settled `hello`
  ** Screenshot of the non-zero exit for the bad effect
  * If unsuccessful
  ** Screenshot of a hang (after 10 s, Ctrl+C) or garbled terminal; `pacman -Q ttfx`
covers: ttfx README "Usage"; install/omarchy-base.packages:107
merged-from: 60:ttfx-terminal-effect

### omasnap-region-capture-annotate-save   [VM-OK] [NET]
description: omasnap's core flow after an install from the omarchy repo: run it, drag a region, annotate with an arrow, a rectangle and text, undo and redo, then save; the PNG appears in ~/Pictures/Screenshots and reopens in the image viewer.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter, install omasnap if needed (`omarchy pkg add omasnap`, password `prime`; if that command is unknown on this build use Omarchy Menu → Install → Package and pick omasnap), then run `omasnap` Enter.
  ** The screen freezes under a translucent overlay with tabs Region / Window / Scrolling Region / Fullscreen and a crosshair with a pixel readout.
  * Drag with the mouse from about (0.2, 0.2) to (0.7, 0.7) of the screen.
  ** The annotation editor opens showing the captured rectangle on a backdrop with a toolbar.
  * Press `A` and drag an arrow across the image; press `R` and drag a rectangle; press `T`, click on the image, type `VM`, Enter.
  ** Arrow, rectangle and the label "VM" are visible.
  * Press Ctrl+Z, then Ctrl+Shift+Z.
  ** The text vanishes, then returns.
  * Press Ctrl+S.
  ** The editor closes and a "Screenshot saved" notification with a thumbnail appears.
  * Press Super+Shift+F, open Pictures → Screenshots and double-click the newest `screenshot-<date>_<time>….png`.
  ** Files renders oversized at 1× (expected). The thumbnail is the annotated shot, and it opens in the image viewer showing the arrow, rectangle and VM label.
  * Close the viewer and Files; in the terminal run `rm ~/Pictures/Screenshots/screenshot-*.png` for the file just made and `sudo pacman -R --noconfirm omasnap` (unless another omasnap test follows), then close it with Super+W.
  ** The desktop must return exactly as left.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * omasnap needs an install first — it is not the stock `Print` editor (that is Tensaku via grim/slurp).
  * Creation tools return to Select after one shape; press the letter again for another. `Enter` saves and copies, `Ctrl+S` saves only.
  * If the overlay never appears, run `omasnap 2>&1 | sudo tee /dev/ttyS0` and read the serial log with get-serial.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the select overlay with tabs and readout
  ** Screenshot of the editor with arrow, rectangle and VM text; one after undo, one after redo
  ** Screenshot of the saved notification and of the PNG open in a viewer
  * If unsuccessful
  ** Serial capture of omasnap's stderr; screenshot of the state it stalled in; the install output if the package was not found
covers: omasnap README "Controls", "Annotation editor", "Edit an existing or clipboard image"
merged-from: 60:omasnap-region-capture-annotate-save

### omasnap-toggle-quick-save-and-clipboard-refusal   [VM-OK] [NET]
description: Launching omasnap while its overlay is open dismisses it instead of capturing the overlay, a fullscreen quick-save skips the editor, and opening a text-only clipboard is refused with exit 1 rather than showing an empty editor.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter; make sure omasnap is installed (`omarchy pkg add omasnap` if not, password `prime`).
  * Run `(sleep 3; omasnap; echo "second exit=$?") & omasnap`.
  ** The overlay opens, and about three seconds later disappears on its own; the terminal shows `second exit=0` and no capture was taken.
  * Run `omasnap --capture-fullscreen --save`.
  ** No overlay; a "saved" notification appears immediately.
  * Press Super+Shift+F and open Pictures → Screenshots.
  ** The newest PNG is a full-screen shot of the desktop (Files renders oversized at 1× — expected). Close Files.
  * Run `echo 'just text' | wl-copy && omasnap --clipboard; echo "exit=$?"`.
  ** An error that the clipboard holds no image, `exit=1`, and no editor window.
  * Remove the PNG just made from `~/Pictures/Screenshots`, run `sudo pacman -R --noconfirm omasnap` (unless another omasnap test follows) and close the terminal with Super+W.
  ** The desktop must return exactly as left.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The background subshell is what a user pressing the hotkey twice does; keep the mouse still while the overlay is up so no region is drawn.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the overlay open, then gone with `second exit=0`
  ** Screenshot of the quick-save notification and the fullscreen PNG in Files
  ** Screenshot of the clipboard refusal with `exit=1`
  * If unsuccessful
  ** Screenshot of an editor opened on text, or of a stuck overlay; serial capture of stderr
covers: omasnap README "One instance, toggled by the same hotkey", "Quick output", "Edit an existing or clipboard image", "Exit codes"
merged-from: 60:omasnap-toggle-and-quick-save

### omasnap-pin-capture   [VM-OK] [NET]
description: Pressing `P` in the omasnap editor pins the capture as an always-on-top image with hover controls, and closing the pin leaves no omasnap process behind.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter; make sure omasnap is installed (`omarchy pkg add omasnap` if not, password `prime`). Run `omasnap`.
  * Drag a region about a quarter of the screen.
  * In the editor press `P`.
  ** The editor closes and a small image of the capture sits pinned at the bottom-right.
  * Press Super+Enter to open another terminal.
  ** The pin stays visible above the new window.
  * Hover the pin, then click its Close control.
  ** Controls (Edit, Link, Copy, Close) appear on hover; after Close the pin is gone.
  * In a terminal run `pgrep -a omasnap; echo "exit=$?"`.
  ** Nothing listed, `exit=1`.
  * Run `sudo pacman -R --noconfirm omasnap` (unless another omasnap test follows) and close the terminals with Super+W.
  ** The desktop must return exactly as left.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The pin is at most a third of the screen wide, lower right. Middle-click also closes it.
  * Double-check the mouse position over the small Close control before clicking.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the pin over a fresh terminal window, and of its hover controls
  ** Screenshot after close with `pgrep` empty and `exit=1`
  * If unsuccessful
  ** Screenshot of the pin missing or stuck; `pgrep -a omasnap`
covers: omasnap README "Pinned captures"
merged-from: 60:omasnap-pin-capture

### omareel-record-and-export   [VM-PARTIAL] [NET]
description: omareel, an opt-in recorder installed from the omarchy repo, opens a compact launcher whose webcam toggle degrades gracefully with no camera; its core action — start a fullscreen recording, stop it, land in the editor, add a zoom and export an MP4 — works with software encoding on the virtio display; stopping when nothing records fails with status 1. Audio, webcam and GPU encoding are not exercised.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter; install omareel with `omarchy pkg add omareel` (password `prime`) if `pacman -Q omareel` says it is missing (10–30 MB). Run `omareel help | head -30`.
  ** Subcommands `record`, `edit`, `export`, `probe`, `help` and record options `--region --fullscreen --window --no-audio --stop --cancel` are listed.
  * Run `omareel &` Enter.
  ** A small launcher (about 380×460, tiled since there is no window rule — expected) with a Record button, capture-mode choice, audio toggles and a webcam toggle. Toggle the webcam option on, then off: no camera exists, so a disabled/"no camera" state is shown, no crash, no self-view window. Close the launcher with Super+W.
  * In the terminal run `omareel record --stop; echo "exit=$?"`.
  ** A message that no recording is active and `exit=1`.
  * Run `OMAREEL_DEBUG=1 omareel record --fullscreen --no-audio --no-selfview`.
  ** Within 3 seconds a recording bar appears top-centre and a REC indicator lights in the Omarchy bar.
  * Wait 5 seconds, type `echo recording` Enter, then run `omareel record --stop`.
  ** The bar disappears and the omareel editor opens on the new bundle with a timeline and preview.
  * Press Space, Space, then `Z`.
  ** Playback started and paused; a zoom block was added on the timeline.
  * Press Ctrl+E, choose MP4, keep defaults, export to `~/Videos/omareel/vmtest.mp4` (Ctrl+L in the file dialog); when the progress indicator finishes, press Super+Shift+F, open Videos → omareel and double-click `vmtest.mp4`.
  ** The export is CPU-encoded (up to a minute); the file sits next to the `.omareel` bundle and plays in mpv. The GTK dialog and Files render oversized at 1× — expected.
  * Close mpv, Files and the editor; run `rm -rf ~/Videos/omareel; sudo pacman -R --noconfirm omareel` and close the terminal with Super+W.
  ** The desktop must return exactly as left.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * No GPU here: if recording does not start, run `cat /tmp/omareel.log | sudo tee /dev/ttyS0`, read it with get-serial, and retry once with `OMAREEL_CAPTURE=gsr` in front of the record command. An encoder error in the log is a valid VM-PARTIAL outcome — report it with the log.
  * A warning that the Hyprland capture-exclusion plugin does not match the running Hyprland is expected, not a failure.
  * Keep acting: a stall over 150 s brings the screensaver.
  * omareel has no chord or menu entry on a stock disk; the terminal is the only launcher.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the install completing and of `omareel help`
  ** Screenshot of the launcher, and of the webcam toggle's no-device state
  ** Screenshot of the `--stop` refusal with `exit=1`
  ** Screenshot of the recording bar and REC indicator
  ** Screenshot of the editor with the zoom block, and of the exported file playing in mpv
  * If unsuccessful
  ** Screenshot of the pacman failure or launcher crash (`omareel 2>&1 | head | sudo tee /dev/ttyS0`); serial capture of /tmp/omareel.log; screenshot of the stalled state
covers: omareel README "Install", "Usage", "Troubleshooting"; omareel docs/USAGE.md "Launcher window", "record", "Stopping a recording", "Editor keys", "Environment"; omarchy-pkgs/pkgbuilds/omareel
merged-from: 60:omareel-record-and-export; 60:omareel-install-and-launcher

### plugin-add-elsewhen-from-menu   [VM-OK] [NET]
description: Setup → Plugins → Add Plugin clones a third-party shell plugin from a pasted git URL after an explicit warning, enables it, and puts the elsewhen globe in the bar with five seeded world clocks; removing it takes the globe away.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Omarchy Menu with Super+Space → Setup → Plugins → Add Plugin.
  ** A floating terminal asks `Git URL of the plugin repo:`.
  * Type `https://github.com/omacom/elsewhen.git` Enter.
  ** A warning "Plugins run as arbitrary, unsandboxed code…" shows the URL and asks `Clone and add this plugin?`.
  * Choose Yes; when asked `Enable 'omacom.elsewhen' now?` choose Yes; if asked for a bar section choose `right`.
  ** `Added omacom.elsewhen into ~/.config/omarchy/plugins/omacom.elsewhen` prints and a globe icon appears in the right section of the bar.
  * Click the globe.
  ** A panel opens with five city rows and times (your location plus four spread round the world) and a globe behind them. Press Escape.
  * Open a terminal with Super+Enter and run `omarchy plugin remove omacom.elsewhen --yes`.
  ** The globe leaves the bar.
  * Close the terminal with Super+W.
  ** The desktop must return exactly as left.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * gum prompts: arrow keys move the highlight, Enter selects.
  * Temperature/currency in the panel come from the network and may still be loading — fine.
  * The elsewhen package recipe installs to a path the plugin catalog never scans at HEAD (03-INTENDED-BEHAVIOUR #24, UNCLEAR pending PR #12051); the git URL is the only working install path — record `omarchy version` with the result.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the warning prompt with the URL
  ** Screenshot of the globe in the bar and of the five-city panel
  ** Screenshot of the bar after removal
  * If unsuccessful
  ** Screenshot of the clone/validation failure; `omarchy plugin list | sudo tee /dev/ttyS0`
covers: default/omarchy/omarchy-menu.jsonc "setup.plugin.add"; bin/omarchy-plugin-add; manual/32-shell-plugins.md "Adding a plugin from git"; elsewhen README "Installing", "The first run"
merged-from: 60:plugin-add-elsewhen-from-menu

### plugin-add-port-forward-error-path   [VM-OK] [NET]
description: The org port-forward bar widget installs, accepts a forward from its panel, and shows a clear error when the SSH host cannot be reached instead of staying on "connecting" forever (no reachable SSH host exists here, so only the error path runs).
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `omarchy plugin add https://github.com/omacom-io/omarchy-port-forward-plugin.git --enable --yes`.
  ** Plugin `port-forward` is enabled; a tunnel icon appears in the bar.
  * Click the icon.
  ** A panel opens with an empty list and an "Add forward" row.
  * Press `a`; fill label `vm`, local port `3000`, SSH host `nohost.invalid`, remote host `localhost`, remote port `3000`; save.
  ** A row `vm` with status `○` appears.
  * Select the row and press Enter.
  ** Status goes `◐` and within ~15 seconds becomes `✕` with an error (name resolution failed); it must not stay on `◐`.
  * Press `x` on the row, confirm deletion, press Escape.
  * Run `omarchy plugin remove port-forward --yes` and close the terminal with Super+W.
  ** The icon leaves the bar; the desktop must return exactly as left.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Panel keys: `j/k` move, `enter` toggle, `a` add, `e` edit, `x` delete, `esc` close.
  * `.invalid` never resolves, which is what exercises the error path without an SSH server.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the empty panel, then of the `vm` row
  ** Screenshot of the `✕` error state with its message
  ** Screenshot of the bar after removal
  * If unsuccessful
  ** Screenshot of a row stuck on `◐` after 30 s; `journalctl --user -u 'omarchy-pf-*' -n 30 --no-pager | sudo tee /dev/ttyS0`
covers: omarchy-port-forward-plugin README "What it does", "Keyboard shortcuts", "Where state lives"
merged-from: 60:plugin-add-port-forward-error-path

### openclaw-launch-and-onboard-without-openclaw   [VM-PARTIAL] [NET]
description: On a disk without OpenClaw, `omarchy openclaw onboard` fails fast with a visible "command not found" instead of hanging in its gateway watch loop, the launcher routes to the onboarding/installer terminal rather than a dead dashboard and rejects a malformed flag, and the Install → AI → OpenClaw row is enabled (the full wizard needs OpenClaw installed plus a provider sign-in and is not run).
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy cmd present openclaw; echo "exit=$?"; ls ~/.openclaw/openclaw.json 2>&1`; expected `exit=1` and `No such file or directory`. If `exit=0`, stop and report — this test assumes OpenClaw is absent.
  * Type `time omarchy openclaw onboard; echo "exit=$?"`; expected within ~3 s a line ending `openclaw: command not found` and `exit=127`.
  * Type `omarchy openclaw --help`; expected `Openclaw commands — OpenClaw agent platform setup:` with `omarchy openclaw onboard`.
  ** An `Unknown Omarchy command` here means the group post-dates this build: record `omarchy version` and report "absent on this build".
  * Type `omarchy-launch-openclaw; echo "exit=$?"` Enter.
  ** A floating Omarchy terminal runs the OpenClaw onboarding or installer — press Ctrl+C at once to abort before anything downloads; if the openclaw command is missing entirely an error line prints instead. Record exactly what appeared; a browser opening a dead dashboard page is the failure.
  * Type `omarchy-launch-openclaw --tui --message; echo "exit=$?"` Enter → `--message needs a value` and a non-zero exit.
  * Press Super+Space → Install → AI: the OpenClaw row is enabled (not dimmed). Press Escape.
  * Type `ls ~/.openclaw 2>&1`; expected still `No such file or directory`. Close the terminal with Super+W; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If a command sits silent for more than 10 s, press Ctrl+C and report a hang (the watch loop running without a wizard).
  * Skipped: onboarding and gateway start (needs installation, network, minutes).
  * ./client-with-image allows you to get an image back of what you did, so can be useful for speeding things up
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the `command not found` line with `exit=127` and the `real` time, the group help, the wizard/installer terminal (or the error line) after the launcher, the `--message` error, the enabled Install → AI row, and the absent `~/.openclaw`
  * If unsuccessful
  ** A silent hang > 10 s, a browser opening a dead page, or files created under `~/.openclaw`; `omarchy version`
covers: bin/omarchy-openclaw-onboard; bin/omarchy:29-97 (openclaw group); bin/omarchy-launch-openclaw; test/shell.d/launch-openclaw-test.sh; default/omarchy/omarchy-menu.jsonc (install.ai.openclaw)
merged-from: 20:openclaw-onboard-without-openclaw; 22:launch-openclaw-not-onboarded

### powerprofiles-set-remember-and-reject   [VM-PARTIAL]
description: `omarchy powerprofiles list` shows what the machine offers and `omarchy powerprofiles set` applies a profile now and remembers it per power source (AC and battery), restores the remembered AC choice on autodetect, and refuses unknown profiles, states and flags without persisting anything; the panel's profile buttons are skipped because there is no battery.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy powerprofiles list; omarchy powerprofiles list --active-state` Enter.
  ** One profile per line (power-saver, balanced, performance — a VM may offer only balanced and performance; record the set); the second listing adds a tab and `1` on the active one.
  ** If the list is empty, type `systemctl is-active power-profiles-daemon` and report it; the remaining steps then show the "not available" errors instead.
  * Type `powerprofilesctl get; cat ~/.local/state/omarchy/powerprofiles/ac 2>&1` Enter and record both (the current profile, and whether an AC preference file exists yet).
  * Type `omarchy powerprofiles set ac power-saver; powerprofilesctl get; cat ~/.local/state/omarchy/powerprofiles/ac` Enter → no output from `set`, then `power-saver` twice.
  ** Use `balanced` here and below if power-saver is not offered, and note it.
  * Type `omarchy powerprofiles set ac balanced; omarchy powerprofiles set; powerprofilesctl get` Enter → `balanced`: the bare `set` is autodetect, which resolves to AC on a machine without a battery and restores the remembered AC choice.
  * Type `omarchy powerprofiles set battery performance; cat ~/.local/state/omarchy/powerprofiles/battery; powerprofilesctl get` Enter → `performance` is written to the battery file while `powerprofilesctl get` stays `balanced` (setting the other power source does not switch now).
  * Negatives, each followed by `; echo "exit=$?"`: `omarchy powerprofiles set ac turbo` → `Power profile is not available: turbo`, `exit=1`; `omarchy powerprofiles set laptop` → `Usage: omarchy-powerprofiles-set [autodetect|ac|battery] [power-saver|balanced|performance]`, `exit=1`; `omarchy powerprofiles list --nope` → usage, `exit=1`. Then `powerprofilesctl get` → still `balanced` (a failed selection is not persisted).
  * Press Super+Ctrl+P: no power panel stays open on a machine without a battery (a brief flicker is acceptable; report if a card stays). The panel's profile buttons are the skipped part.
  * Restore: `omarchy powerprofiles set ac <profile recorded in step 2>; rm -f ~/.local/state/omarchy/powerprofiles/battery` (also `rm -f ~/.local/state/omarchy/powerprofiles/ac` if that file did not exist in step 2). Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * `omarchy powerprofiles …` routes to `omarchy-powerprofiles-list` / `omarchy-powerprofiles-set`; the bare binaries behave the same.
  * Exit codes are invisible on a screenshot — keep the `; echo "exit=$?"` on every negative.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the two listings, `powerprofilesctl get` after each `set` matching the stored preference, the AC and battery state files, the unchanged active profile after setting battery, the three refusals with `exit=1` and the unchanged profile after them, and the desktop after Super+Ctrl+P with no lingering power card
  * If unsuccessful
  ** A `set` reporting success while `powerprofilesctl get` disagrees, a refusal accepted or persisted, autodetect applying the battery preference on AC, or a panel card that stays open; the daemon status and `omarchy-version`
covers: manual/36-system-sleep.md (Power profiles); bin/omarchy-powerprofiles-list; bin/omarchy-powerprofiles-set; bin/omarchy-powerprofiles-init; shell/plugins/panels/power/Panel.qml; shell/plugins/services/battery/Service.qml; default/hypr/bindings/utilities.lua (SUPER+CTRL+P); test/shell.d/powerprofiles-set-test.sh; test/shell.d/power-test.sh
merged-from: 12:powerprofiles-list-set-and-reject; 24:powerprofiles-set-remember-and-reject; 52:powerprofiles-set-without-battery

### system-stats-cli-output   [VM-OK]
description: `omarchy-system-stats` prints the CPU and memory lines the power panel consumes and reacts to load; a bad flag is refused with a usage line.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy-system-stats` Enter.
  ** Two lines: `cpu` with a percentage and `memory` as `X.XGB / 4GB`.
  * Type `omarchy-system-stats --bar-widget` Enter.
  ** Three lines: cpu counters, memory percentage, load.
  * Type `yes > /dev/null & sleep 3; omarchy-system-stats; kill %1` Enter.
  ** The cpu percentage is clearly higher than at rest.
  * Type `omarchy-system-stats --bogus; echo "exit=$?"` Enter.
  ** `Usage: omarchy-system-stats [--bar-widget]` and a non-zero exit.
  * Close the terminal with Super+W; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Tabs render as wide gaps in the terminal.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the two-line output with 4GB total, the three-line output, the raised cpu figure and the usage error
  * If unsuccessful
  ** Missing lines, a wrong total, or awk errors
covers: bin/omarchy-system-stats; shell/plugins/panels/power/Panel.qml
merged-from: 24:system-stats-output

### toggle-generic-flag-and-bad-action   [VM-OK]
description: The generic `omarchy-toggle` creates and removes a flag file, is idempotent on `on`, flips on a bare call and rejects unknown actions; `omarchy-toggle-enabled` answers by exit code. Protects the primitive every named toggle builds on.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `ls ~/.local/state/omarchy/toggles/ 2>&1` Enter → no `demo-flag` listed.
  * Type `omarchy-toggle demo-flag on; echo "exit=$?"; omarchy-toggle-enabled demo-flag; echo "exit=$?"` Enter → `exit=0` twice; `ls ~/.local/state/omarchy/toggles/` now shows `demo-flag`.
  * Type `omarchy-toggle demo-flag on; echo "exit=$?"; ls ~/.local/state/omarchy/toggles/ | grep -c demo-flag` Enter → `exit=0` and `1` (still one file).
  * Type `omarchy-toggle demo-flag; echo "exit=$?"; omarchy-toggle-enabled demo-flag; echo "exit=$?"` Enter → the bare call toggles it off: `exit=0` then `exit=1`.
  * Type `omarchy-toggle demo-flag; omarchy-toggle-enabled demo-flag; echo "exit=$?"; omarchy-toggle demo-flag off; omarchy-toggle-enabled demo-flag; echo "exit=$?"` Enter → on again (`exit=0`), then off (`exit=1`).
  * Negatives: `omarchy-toggle demo-flag sideways; echo "exit=$?"` → usage on stderr, `exit=1`; `omarchy-toggle; echo "exit=$?"` → usage, `exit=1`.
  * Type `ls ~/.local/state/omarchy/toggles/ 2>&1` Enter → `demo-flag` is not there. Close the terminal with Super+W; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Exit codes are invisible on a screenshot — every call carries `; echo "exit=$?"`.
  * `omarchy-toggle` writes only under `~/.local/state/omarchy/toggles/`; nothing on screen changes, the terminal is the whole proof.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Terminal screendumps with the exit-code sequence 0 0 · 0 1 · 0 1 · 0 1 · 1 1, the `demo-flag` file present then absent in `ls`, and the two usage lines
  * If unsuccessful
  ** The line whose exit code differs, or a `demo-flag` left behind
covers: bin/omarchy-toggle; bin/omarchy-toggle-enabled; test/shell.d/toggle-test.sh
merged-from: 25:toggle-generic-flag-and-bad-action

### cliamp-music-tui-without-audio   [VM-PARTIAL] [NET]
description: Super+Shift+Alt+M opens the Cliamp terminal music player and a second press focuses rather than duplicates it; with no sound card the guest can only verify the UI, the `?` help, the launcher row and a graceful outcome when a station is played (a "playing" state on the Dummy Output or a playback error — never a crash).
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Shift+Alt+M.
  ** A terminal window opens running Cliamp: a Winamp-style panel with a playlist / radio station list and transport controls (window class `org.omarchy.cliamp`).
  ** Super+Shift+M (without Alt) is the Spotify chord, which starts an installer immediately — do not press it.
  * Press `?`: the keybinding list overlays. Press Escape (or `?` again) to dismiss it.
  * Select a radio station and press Enter/play.
  ** The guest has no sound card but pipewire offers a `Dummy Output` (auto_null) sink, so Cliamp may show a "playing" state with no audible sound, or a playback error message inside Cliamp; either is acceptable. It must not crash or freeze. Record which.
  * Press Super+Shift+Alt+M again.
  ** The existing Cliamp window is focused; no second window appears.
  * Press Super+Alt+Space and type `cliamp`: a Cliamp app row exists. Press Escape.
  * Quit Cliamp with `q` (or Super+W); the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Skipped here: audible audio output; the station stream needs the network (a few hundred KB).
  * If the chord opens nothing, run `pacman -Q cliamp` and `cliamp --version` in a terminal and report.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of Cliamp's main screen, the `?` help, the state after play (error or silent playing), the single window after the second chord, and the launcher row
  * If unsuccessful
  ** Screenshot of a crash/blank terminal or a duplicate window; `cliamp --version`
covers: manual/21-tuis.md:41-43; default/hypr/bindings/applications.lua:15; bin/omarchy-launch-or-focus-tui; install/omarchy-base.packages (cliamp)
merged-from: 11:cliamp-music-tui-without-audio

### launcher-gui-apps-open-and-close   [VM-PARTIAL]
description: The preinstalled GUI apps the manual says to start from the app launcher (Pinta, Aether, Omacut, LibreOffice Writer, Disks, Moonlight, Kdenlive, OBS Studio) each open a window from the Apps menu and close cleanly; heavy OpenGL apps run on software rendering here, so only "opens and closes" is checked.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Alt+Space, type `Pinta`, Enter: an image editor with a toolbox and a blank canvas opens (up to 30 s). Screenshot, then Super+W (dismiss any "save changes?" with Don't Save / Discard).
  ** Heavy apps may raise Hyprland's "not responding" dialog: click **Wait**. If a window has not painted after 45 s, screenshot and report it as slow rather than waiting.
  * Repeat for `Aether`: the theming app with an image/colour extraction view. Screenshot, Super+W.
  * Repeat for `Omacut`: the video trimmer window (empty timeline / open-file prompt). Screenshot, Super+W.
  * Repeat for `LibreOffice Writer`: a blank document (the Start Center is hidden from the launcher; Writer/Calc/Impress rows exist). Screenshot, Super+W, Don't Save.
  * Repeat for `Disks`: GNOME Disks showing the 40 GB virtio disk `/dev/vda` (GTK renders oversized at 1× — expected). Screenshot, Super+W.
  * Repeat for `Moonlight`: the streaming client showing "Searching for PCs…" / an Add PC button. Screenshot, Super+W.
  * Repeat for `Kdenlive`: the video editor (a first-run config wizard may appear; accept defaults). Screenshot, Super+W.
  * Repeat for `OBS Studio`: the OBS main window (an auto-configuration wizard may appear; cancel it; a "no audio device" indicator is expected). Screenshot, Super+W. The desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Skipped here: any actual editing, streaming or recording; audio and GPU features.
  * Kdenlive and OBS are the slowest under llvmpipe. Media windows (Pinta, Kdenlive, OBS) are configured opaque; that is expected.
  * A missing launcher row is a real failure: all eight are in the base package set.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** One screenshot per app showing its main window, and the empty desktop at the end
  * If unsuccessful
  ** Screenshot of the missing row or blank window; `journalctl --user -n 30 | sudo tee /dev/ttyS0` read via get-serial for that launch
covers: manual/22-guis.md:27-37,56-60,74-96; manual/26-gaming.md:63; install/omarchy-base.packages (pinta, aether, omacut, libreoffice-fresh, gnome-disk-utility, moonlight-qt, kdenlive, obs-studio); default/omarchy/launcher.hides; default/hypr/apps/system.lua:41-52
merged-from: 11:launcher-gui-apps-open

### pdf-open-evince-and-fill-xournalpp   [VM-OK]
description: Double-clicking a PDF opens Document Viewer (the `application/pdf` default), Open With… offers Xournal++, and Xournal++ lets the user place text with the T tool and export a PDF — the whole "fill out a non-form PDF" flow the manual describes.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return and type `mkdir -p /tmp/pdf && cd /tmp/pdf && printf 'Name: ______\n' > form.txt && libreoffice --headless --convert-to pdf form.txt >/dev/null && ls` Enter → `form.pdf`.
  ** If the LibreOffice conversion is unavailable, use any PDF: `fd -e pdf . /usr/share | head -1` and `cp` it to `/tmp/pdf/form.pdf`.
  * Type `xdg-mime query default application/pdf` Enter → `org.gnome.Evince.desktop`.
  * Press Super+Shift+Alt+F (Files in `/tmp/pdf`); if that chord does nothing on this build, press Super+Shift+F (Files) and navigate to `/tmp/pdf`. Double-click `form.pdf`: Document Viewer (Evince) opens the page in a floating window. Close it with Super+W.
  ** Files, Evince and the chooser are GTK and render oversized at 1× — expected.
  * Right-click `form.pdf` → *Open With…* → choose Xournal++ (type `Xournal` to filter the chooser) → Open. Xournal++ opens (tiled) with the PDF as the background; dismiss any first-run dialog.
  * Press `T` (or click the Text tool in the toolbar), click on the page next to `Name:`, type `Prime`, click elsewhere. The text sits on the page.
  * Menu *File → Export as PDF*, name `filled.pdf` in `/tmp/pdf`, Save. Close Xournal++ with Super+W (discard the `.xopp` save prompt).
  * In the terminal type `ls /tmp/pdf` Enter → `filled.pdf` present; `xdg-open /tmp/pdf/filled.pdf` Enter → Evince shows the page with `Prime` on it. Close it, close Files, then `cd && rm -rf /tmp/pdf` and close the terminal with Super+W; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The Open With chooser is a GTK dialog; type to filter. Double-check the mouse position before clicking in the oversized dialogs.
  * Evince's window floats (rule), Xournal++ tiles.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the `xdg-mime` answer, Evince on `form.pdf`, the Open With chooser with Xournal++, the typed text on the page, the export dialog, and Evince showing `filled.pdf` with `Prime`
  * If unsuccessful
  ** Screenshot of the step that failed (a different viewer opening, Xournal++ missing from the chooser, no export) and `xdg-mime query default application/pdf`
covers: manual/27-filling-out-pdfs.md; install/omarchy-base.packages (evince, xournalpp); default/hypr/apps/system.lua:7
merged-from: 11:pdf-open-and-annotate-xournalpp

### imv-rotate-edit-trash-keybindings   [VM-OK]
description: In imv, Omarchy's bindings make Ctrl+R rotate the image on disk, Ctrl+E hand it to Tensaku, and Ctrl+X move it to the Trash and quit; a missing file yields an error rather than a blank viewer.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter and type `mkdir -p /tmp/imvt && cp /usr/share/omarchy/default/plymouth/logo.png /tmp/imvt/a.png && cp /tmp/imvt/a.png /tmp/imvt/b.png && identify -format '%wx%h\n' /tmp/imvt/a.png && imv /tmp/imvt/a.png &` Enter.
  ** The dimensions print and imv shows the logo in a floating window.
  * Click the imv window and press Ctrl+R → the image rotates 90°. Click the terminal and type `identify -format '%wx%h\n' /tmp/imvt/a.png` Enter → swapped dimensions (the rotation was written to disk).
  * Click imv and press Ctrl+E → Tensaku opens the image and imv quits. Press Super+W on Tensaku.
  * In the terminal type `imv /tmp/imvt/b.png &` Enter, click the imv window and press Ctrl+X.
  ** imv quits; type `ls /tmp/imvt; gio list trash:// | grep b.png` Enter → `b.png` gone from the folder and present in the Trash.
  * Type `imv /tmp/imvt/missing.png` Enter → an error about the file; press `q` if a window opened.
  * Type `rm -rf /tmp/imvt; gio trash --empty` Enter and close the terminal with Super+W; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Click the imv window before pressing its shortcuts so they are not sent to the terminal.
  * imv is a floating viewer by window rule; Tensaku is the stock screenshot editor.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of imv with the image, the swapped dimensions, Tensaku opening, the folder listing plus Trash entry, and the missing-file error
  * If unsuccessful
  ** Screenshot of a shortcut doing nothing, a file deleted without landing in Trash, or Tensaku not opening
covers: config/imv/config; applications/imv.desktop; default/tensaku/state.toml
merged-from: 41:imv-omarchy-keybindings

### chromium-whatsapp-slim-extension   [VM-PARTIAL] [NET]
description: The WhatsApp web app opens as a Chromium app window in which the bundled WhatsApp Slim extension forces system-theme (dark) mode and keeps the page usable in a narrow window; the narrow-window chat-list collapse needs a logged-in account and is skipped.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Shift+Alt+G (or Super+Alt+Space → WhatsApp → Enter).
  ** A Chromium app window (no address bar) shows the WhatsApp Web login/QR page in dark colours. Click **Wait** on a "not responding" dialog; the page takes 10–20 s over NAT.
  * Press F12; in the Console type `localStorage.getItem("system-theme-mode")` Enter → `"true"`. Press F12 again to close.
  ** Skip this step and record it if DevTools is unavailable in app mode.
  * Press Super+T: the app window floats (no title bar).
  * Drag the window's right edge to make it narrower than about half the screen.
  ** The page still renders without a horizontal scrollbar.
  * Press Super+T again to re-tile, then Super+W to close the window; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Skipped: logging in (needs a phone) and the 90 px avatar rail below 1100 px.
  * Drag from the window edge, not the title area; floating windows have no title bar.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the dark WhatsApp login page in an app window, the console value `"true"` (or the note that DevTools was unavailable), and the narrowed window without a horizontal scrollbar
  * If unsuccessful
  ** Screenshot of a light-themed page, a horizontal scrollbar, or the window failing to open
covers: default/chromium/extensions/whatsapp-slim/*; applications/WhatsApp.desktop; bin/omarchy-launch-webapp
merged-from: 41:chromium-whatsapp-slim-theme

### plugin-add-notification-center-and-dnd   [VM-OK] [NET]
description: The org notification-center plugin installs with one command, shows a sent notification in its popup with Pending/Recently tabs, and its Do Not Disturb toggle silences toasts; removal restores the bar.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `omarchy plugin add https://github.com/omacom-io/omarchy-notification-center-plugin.git --enable --yes`.
  ** It clones, validates, enables `omacom.notification-center`; a bell-style icon appears in the right section of the bar.
  * Run `omarchy-notification-send "VM notification" "from the guest"`.
  ** A toast appears and fades.
  * Click the notification-center icon.
  ** A popup with Pending and Recently tabs lists "VM notification". Click Mark All as Seen, then Recently — it moved there.
  * Toggle Do Not Disturb on, close the popup, run `omarchy-notification-send "silenced?"`.
  ** No toast; the bar shows the DND indicator.
  * Reopen the popup, toggle DND off, click Clear Recent.
  ** Recently is empty.
  * Run `omarchy plugin remove omacom.notification-center --yes` and close the terminal with Super+W.
  ** The icon leaves the bar; the desktop must return exactly as left.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * `--yes` skips the interactive warning; the warning path is covered by the elsewhen test.
  * Hover the right section of the bar to find the new icon if the glyph is unfamiliar. The stock DND toggle gives no toast of its own — the missing toast after the second send is the proof.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the popup listing "VM notification", then of it under Recently
  ** Screenshot of DND on with no toast after the second send
  ** Screenshot of the bar after removal
  * If unsuccessful
  ** Screenshot of the missing widget or popup, or a toast shown under DND; `omarchy plugin list | sudo tee /dev/ttyS0`
covers: omarchy-notification-center-plugin README; bin/omarchy-plugin-add (--enable --yes); bin/omarchy-plugin-remove
merged-from: 60:plugin-add-notification-center

### omarchy-audio-tuner-probe-without-device   [VM-PARTIAL] [NET]
description: The speaker-tuning authoring tool installs from the omarchy repo, prints usage, generates its probe offline, and fails cleanly when asked to capture from a sink that does not exist; the real measure-through-speakers workflow is skipped (no audio device).
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `pactl list short sinks`.
  ** What audio the VM has — the pipewire `auto_null` Dummy Output or nothing; include it in the report.
  * Run `omarchy pkg add omarchy-audio-tuner` (password `prime`).
  * Run `omarchy-audio-tuner; echo "exit=$?"`.
  ** Usage listing `probe capture analyse delta fit generate mic-sweep compare switch` and a non-zero exit.
  * Run `omarchy-audio-tuner probe && ls ~/.cache/omarchy-audio-tuner/`.
  ** A probe WAV and its tone list are generated (ffmpeg only, no hardware).
  * Run `omarchy-audio-tuner capture no-such-sink ~/raw.wav; echo "exit=$?"`.
  ** A clear error about the missing sink (not a traceback), non-zero exit, no `~/raw.wav`.
  * Run `rm -rf ~/.cache/omarchy-audio-tuner ~/raw.wav; sudo pacman -R --noconfirm omarchy-audio-tuner` and close the terminal with Super+W.
  ** The desktop must return exactly as left.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Skipped: the measure-through-speakers workflow (`capture` on a real sink, `analyse`, `fit`, `switch`) — no audio device.
  * If `omarchy pkg add` reports `target not found`, record `omarchy version`; the package may post-date this repo snapshot.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the sink list, the usage text and of the generated probe files
  ** Screenshot of the clean capture failure with its exit code
  * If unsuccessful
  ** Screenshot of a traceback or hang; `pacman -Ql omarchy-audio-tuner | head`
covers: omarchy-audio-tuner README "The short version"; docs/audio-tuning.md; omarchy-pkgs/pkgbuilds/omarchy-audio-tuner
merged-from: 60:omarchy-audio-tuner-no-audio-device

## Not runnable here

### hype-open-sample-deck   [VM-NO]
description: Hype (Markdown presentations) is not packaged — absent from the omarchy repo despite its README, and the AUR `hype` is an unrelated Twitch client — so opening a sample deck would need a from-source Qt build that exceeds the session budget; a driver on a stable disk can only prove the absence.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Not runnable here. For the record, once `hype` exists in the omarchy repo: `omarchy pkg add hype`, launch Hype from the Apps menu, Open a Markdown deck, verify the slide sidebar and preview, F5 to present, arrows to navigate, Escape back, Ctrl+E for Markdown mode, Export → PDF.
  ** A driver on a stable disk can only prove the absence: open a terminal with Super+Enter, `omarchy pkg add hype; echo "exit=$?"` → `error: target not found: hype`, `exit=1` (03-INTENDED-BEHAVIOUR #23, DEFECT in the hype README). Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Do not install the AUR `hype`; it is a Twitch client, not this app.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Not applicable until packaged; the absence proof is the `target not found: hype` error with `exit=1`
  * If unsuccessful
  ** Not applicable
covers: hype README "Install", "Keyboard shortcuts"; omarchy-pkgs (no recipe); AUR `hype`
merged-from: 60:hype-open-sample-deck

### monologue-webcam-recording   [VM-NO]
description: Monologue records from a webcam with a live microphone meter; the guest has neither device and the package is only on the edge channel, so the core action cannot run here.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Not runnable here: `omarchy pkg add monologue` fails on the stable channel (edge-only package) and recording needs a camera.
  ** For the record, on real hardware: launch Monologue from the Apps menu, choose camera and microphone, Space to record, Space to pause/resume, Ctrl+Enter to finish, Ctrl+S to save, "Open in Omacut" to hand the clip over; Esc discards after confirmation, Q quits.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Appendix entry only; do not attempt on the minted disk.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Not applicable in the QEMU guest
  * If unsuccessful
  ** Not applicable
covers: monologue README; omarchy-pkgs/pkgbuilds/monologue (edge only)
merged-from: 60:monologue-webcam-recording

### hypr-gaming-and-vendor-window-rules   [VM-NO]
description: Steam, Battle.net, RetroArch, Moonlight, GeForce NOW, DaVinci Resolve, JetBrains, Telegram, Hermes, 1Password/Bitwarden and the Windows VM rules exist for apps a stock disk does not have; only their presence and parseability can be checked here, the rules themselves need the apps (and a GPU or an account).
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return and run `ls /usr/share/omarchy/default/hypr/apps/ | sudo tee /dev/ttyS0` (password `prime`); read it with get-serial.
  ** The rule files from the inventory: 1password, battlenet, bitwarden, davinci-resolve, geforce, hermes, jetbrains, moonlight, retroarch, steam, telegram, windows-vm, qemu (plus the browser/system files other tests exercise).
  * Run `hyprctl configerrors` → empty (every rule file parses). Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Not runnable here: none of those apps are installed and several need a GPU or an account; only the smoke check above runs.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The directory listing (serial) and empty configerrors
  * If unsuccessful
  ** A parse error naming one of the app rule files
covers: default/hypr/apps/{1password,battlenet,bitwarden,davinci-resolve,geforce,hermes,jetbrains,moonlight,retroarch,steam,telegram,windows-vm,qemu}.lua
merged-from: 40:hypr-gaming-and-vendor-window-rules

## Moved to other domains

- 52:plugin-add-refuses-transport-helpers-and-duplicate-ids → H — plugin URL-guard and local-repo add story; same story as H's 25:plugin-add-rejects-unsafe-urls, 51:git-url-check-refuses-transport-helpers and 12:plugin-add-local-git-repo-lifecycle; writing it here would duplicate H.
- 24:battery-absent-paths → D — battery/power-widget absence on the bar and the Super+Ctrl+Alt+B toast; same story as D's 30:right-section-panels-without-hardware and 30:notification-time-and-battery-hotkeys.
- 31:power-widget-hidden-no-battery → D — power widget hidden, Super+Ctrl+P no-op, Battery Percentage row absent; same story as D's 30:right-section-panels-without-hardware.
- 50:panel-power-hidden-without-battery → D — acceptance-suite form of the same hidden-power-panel story (`upower -e | grep -c /battery_` → 0, `omarchy-shell shell ping` → ok).
- 41:oomd-app-slice-candidacy → D — systemd-oomd 50 %/20 s policy and app.slice candidacy; configuration half of D's 24:oomd-kills-runaway-app-not-session.
- 41:resolved-and-nsswitch-defaults → H — systemd-resolved/NetworkManager/nsswitch system defaults; sits with H's 50:system-services-enabled-and-running, not an application.
- 23:gaming-gpu-lib32-no-gpu-exit-status → F1 — the lib32 helper's exit-1 defect is what makes F1's Steam/Heroic/Lutris/Battle.net installers fail (11:install-steam, 23:install-gaming-*); install machinery, not an app in use.
- 23:gaming-xbox-controllers-driver-without-bluetooth → F1 — Install → Gaming → Xbox Controllers / Remove → Gaming round trip is install-remove machinery (sibling 23:gaming-xbox-cloud-webapp-install-remove).
- 25:speaker-tuning-on-matching-laptop → H — VM-NO audio-tuning story; belongs beside H's 61:audio-tuning-no-matching-hardware and 41:hardware-only-units-inert (speaker tuning) in its not-runnable appendix.
- 61:plans-unshipped-features-absent → G2 — router "Unknown Omarchy command" negatives for unshipped plans plus the sunshine remainder; same surface as G2's 23:install-service-sunshine-cli-only and the CLI-router tests.

## Dropped

- none
