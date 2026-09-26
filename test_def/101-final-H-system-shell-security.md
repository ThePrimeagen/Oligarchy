# H — System, shell and security — final tests

This domain covers what the desktop user meets below the graphical shell: the interactive bash
shell (aliases, `fns/*` functions with their missing-argument paths, `tds`/`tdl`, `rsw`/`lsw`,
`man` through bat, readline), the default applications and MIME handlers, Chromium's bundled
extensions and the root-owned browser colour policy, CUPS, Docker, the firewall, the four sudoers
drop-ins and sudo's retry behaviour, the Security setup wizards (SSHD, FIDO2, Passwordless Sudo,
Sudoless Docker; Fingerprint hidden), DNS presets and Custom DNS, network helpers on a wired-only
guest, the default agent and crash capture, first-run/provisioning artefacts and the one-shot
post-update hooks, the hardware-absence sweep, system and user systemd units, kernel tuning,
locale and timezone. First pass: 147 source blocks → **62 tests** (128 blocks) plus **2 not runnable**
(Wi-Fi hardware, 1Password GPU prompts); **17 blocks moved** to B (quickshell restart/supervisor,
nightlight), D (`omarchy-shell` IPC, plugins loaded, media service), F1 (plugin add lifecycle,
Docker DB, Chromium Account, Kitty install), F2 (PDF annotate) and G1 (kitty migration); **0
dropped**. Largest merges: seven passwordless-sudo blocks into one toggle/expiry story; six crash
blocks into a toast-and-mute story plus a CLI-refusals story; four Chromium blocks into one
extensions-and-copy-URL story; four hardware-detector blocks into one absence sweep; three each
for DNS presets, Custom DNS, Sudoless Docker, CUPS, firewall, sudo retries, timezone, FIDO2,
git-url-check and the shell environment. 01-FACTS corrections applied: the `omarchy-dns` and
`omarchy-tzupdate` sudoers rules exist since 4.0.2, so DNS pills/menu rows and the timezone
picker are asserted to run with **no** password or polkit dialog; crash toasts need a default
agent name first; menu guards paint from the previous open (reopen twice before asserting a ✓ or
a hidden row). `03-INTENDED-BEHAVIOUR.md` verdicts applied: item 2 (`sshd --key=<bad>` enabling
sshd and opening 22 before validation) is a **DEFECT**, so `sshd-setup-rejects-bad-arguments-and-bad-key-before-opening-port`
asserts the intended side (sshd still disabled, no 22 rule) and records the observed HEAD state as
the defect; item 11 (stale `omarchy finalize user` usage string) is recorded in the provisioning
test; item 22 (faillock `deny=10`), (a) `Super+Space` root / `Super+Escape` System, (b) no clock on
the lock screen and A1 (Defaults → Browser lists every browser) are asserted as CODE-INTENDED. The
`tdl` undefined-`$opencode_pane` defect has no verdict, so its tests record the observed error and
name it as a defect. Routing pass: 47 incoming blocks — 26 folded into existing tests (DNS ×4,
sudoless Docker ×3, sshd ×4, provisioning ×4, and others), 19 became 12 new tests (tmux
`tdl`/`tsl`/`tdlm`, fingerprint absence, pacman repos and signing key, zram swap + oomd, shell
supervisor, shell restart with lock guard, nightlight, plugin registry validation, plugin API
boundary, plocate index, install log/timing, mise Node bundle), 2 are VM-NO (real
fingerprint/FIDO2 enrolment, speaker tuning on matching hardware). The incoming blocks were re-checked
against 03-INTENDED-BEHAVIOUR: item 2 also governs the SSHD menu cancel/empty-key paths (asserted as
not half-hardened; HEAD's active sshd + LIMIT rule recorded as the defect) and the GitHub unknown-user
path; item (a) replaced `Super+Escape` menu paths with `Super+Space`; the 12/51 DNS polkit hedges were
dropped per 01-FACTS. Final: **74 tests** (64 VM-OK, 10 VM-PARTIAL; 12 NET, 1 SLOW) + 4 not runnable.

## Tests

### terminal-hotkey-opens-foot-in-cwd   [VM-OK]
description: Super+Enter opens the default terminal — foot with Omarchy's font, padding, theme and Starship prompt — in the focused terminal's directory, its copy/paste keys work, and the `omarchy cmd` predicates behind that behaviour answer with exit codes.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter. A tiled terminal with no title bar, a dark themed background, visible inner padding and a prompt ending in a cyan `❯` must open; no `username@host` in the prompt and no fastfetch banner.
  * Type `echo $TERM; omarchy default terminal; grep -E '^(font|pad)' ~/.config/foot/foot.ini` and press Enter. Expect `xterm-256color`, `foot`, `font=JetBrainsMono Nerd Font:size=9`, `pad=14x14`.
  * Type `cd /tmp && omarchy cmd terminal cwd` and press Enter → `/tmp`. With this terminal focused press Super+Enter: a second terminal opens; type `pwd` + Enter in it → `/tmp` (the new terminal follows the focused terminal's directory).
  ** Keep the mouse over the first terminal before pressing Super+Enter; the cwd of the *focused* window is what is read.
  * In the second terminal type `omarchy cmd present bash jq; echo "exit=$?"` → `exit=0`; `omarchy cmd present bash no-such-cmd-qa; echo "exit=$?"` → `exit=1`; `omarchy cmd missing no-such-cmd-qa; echo "exit=$?"; omarchy cmd missing bash; echo "exit=$?"` → `exit=0` then `exit=1`.
  * In the first terminal drag the mouse over the word `xterm-256color`, press Ctrl+Shift+C, type `echo ` and press Ctrl+Shift+V, then Enter → the pasted word echoes back. Press Super+C with nothing selected, then type `echo copied` + Enter — the terminal must neither close nor break (Super+C maps to Ctrl+Insert inside terminals).
  * Type `echo held` and press Shift+Enter (not Enter): the command must NOT run (foot sends a CSI-u code instead of a newline). Press Ctrl+C.
  * Close both terminals with Super+W; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * foot's window class is `foot`; there are no tabs or splits, so a second Super+Enter always makes a second window.
  * If the first terminal opened somewhere other than home that is fine; only the second must follow the first's `cd`.
  * Double-check the selection highlight before pressing Ctrl+Shift+C.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the fresh terminal (padding, colours, `❯`), the `xterm-256color` / `foot` / font / pad lines, `/tmp` from `cmd terminal cwd` and the second terminal's `pwd` printing `/tmp`
  ** Screenshot of the four `exit=` lines, the echoed paste, and the un-executed line after Shift+Enter
  * If unsuccessful
  ** Screenshot of whatever opened (wrong program, decorations, default font) or of the second terminal opening in `/home/prime` while the focused one was in `/tmp`; `journalctl --user -n 50 | sudo tee /dev/ttyS0` read via get-serial
covers: manual/15-terminal.md:3-7; default/hypr/bindings/applications.lua:2; bin/omarchy-launch-terminal; bin/omarchy-launch-terminal:6; bin/omarchy-cmd-terminal-cwd; bin/omarchy-cmd-present; bin/omarchy-cmd-missing; config/foot/foot.ini; applications/foot.desktop; default/xdg-terminal-exec/hyprland-xdg-terminals.list; default/uwsm/default; test/acceptance.d/apps-test.sh (terminal row)
merged-from: 11:terminal-hotkey-opens-foot; 41:terminal-foot-default-config; 20:cmd-predicates-and-terminal-cwd

### foot-ini-padding-edit-applies-to-new-window   [VM-OK]
description: `~/.config/foot/foot.ini` controls the default terminal: a padding change is visible in the next terminal opened while running windows keep the old value, and restoring the file restores the look.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter and screenshot the terminal (note the ~14 px gap between the window border and the prompt text). Type `grep -n '^pad=' ~/.config/foot/foot.ini` + Enter → `pad=14x14`.
  * Type `sed -i 's/^pad=.*/pad=60x60/' ~/.config/foot/foot.ini && grep -n '^pad=' ~/.config/foot/foot.ini` + Enter → `pad=60x60`.
  * Press Super+Enter to open a second terminal.
  ** The new window has a visibly larger inner margin (about 60 px) around the text; the first window is unchanged (foot does not reload a running window).
  * In the new terminal type `sed -i 's/^pad=.*/pad=14x14/' ~/.config/foot/foot.ini` + Enter; press Super+Enter → the third terminal's margin is back to normal.
  * Type `grep -n '^pad=' ~/.config/foot/foot.ini` + Enter → `pad=14x14`. Close all terminals with Super+W (or Ctrl+Alt+Delete, which is bound to close-all-windows).
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The terminals tile automatically side by side; one screenshot shows the 14 px and 60 px windows together.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Side-by-side screenshot of the 14 px and 60 px padded terminals
  ** Screenshot of the third terminal after the restore and the `pad=14x14` line
  * If unsuccessful
  ** foot failing to start (no window) or an error toast, plus `cat ~/.config/foot/foot.ini | sudo tee /dev/ttyS0` read via get-serial
covers: manual/31-dotfiles.md (~/.config/foot/foot.ini), config/foot/foot.ini
merged-from: 12:foot-ini-padding-edit

### tmux-work-session-config-and-reattach   [VM-OK]
description: Super+Alt+Enter and the `t` alias give a tmux with Omarchy's config (status bar on top, Ctrl+Space prefix, Alt-key splits, keybindings popup) attached to the persistent `Work` session, so closing the window never loses the shell and re-attaching restores it.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Alt+Enter. A terminal inside tmux must open: a status line along the TOP with the session name `Work` on a blue block (left) and the hostname (right).
  * Type `export MARKER=alive` and press Enter.
  * Press Alt+Enter, then Alt+Shift+Enter: the pane splits stacked, then the active pane splits side by side (three panes). Press Alt+Escape twice → one pane remains.
  * Press Ctrl+Space then `?` → a centred popup "Tmux keybindings" lists bindings; press `q`. Press Ctrl+Space then `s` → tmux's session chooser lists `Work`; press Escape (or `q`).
  * Close the window with Super+W (this detaches; it does not kill tmux). Press Super+Alt+Enter again: the same session re-attaches; type `echo $MARKER` + Enter → `alive`.
  * Press Ctrl+Space then `d` → detached, the window closes. Press Super+Enter and type `t` + Enter → tmux re-attaches to the existing session (same top status bar).
  * Type `tmux kill-server` and press Enter to clean up; press Ctrl+D if a plain shell remains. The desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Send Ctrl+Space with send-keys as `<C-SPACE>`; the secondary prefix Ctrl+B (`<C-b>`) is configured too. Ctrl+Space is also the stock fcitx5 trigger — if the prefix seems swallowed, use `<C-b>` and report it.
  * The status bar shows `PREFIX` on the right while the prefix is armed, which proves the prefix key arrived. Window names follow the current directory basename.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the top status bar with `Work`, the three-pane split, the keybindings popup, the session chooser, and `echo $MARKER` printing `alive` after re-attaching; the `t` re-attach
  * If unsuccessful
  ** Screenshot of the terminal after Super+Alt+Enter (plain shell instead of tmux, bottom status bar, or error text), the prefix not working, and `tmux ls` output
covers: manual/15-terminal.md:9-15; default/hypr/bindings/applications.lua:12; bin/omarchy-launch-terminal-tmux; config/tmux/tmux.conf; default/bash/aliases:52 (`t`); default/hypr/bindings/applications.lua
merged-from: 11:tmux-session-attach-and-resume; 41:tmux-omarchy-config-and-t-alias

### tmux-dev-square-tds-and-tdl   [VM-PARTIAL] [NET]
description: `tds` lays out the four-way development square (Neovim, `hunk diff --watch`, terminal, opencode) and `tdl` its sibling layout; in the guest the two agent-side panes only reach mise's first-run download, so the check is the geometry, the started commands, the `Usage` refusal, and the known `tdl` defect (it ends on an undefined `$opencode_pane`).
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter, type `mkdir -p /tmp/sq && cd /tmp/sq && git init -q && t` and press Enter (tmux starts).
  * Type `tds extra` and press Enter. It must print `Usage: tds`.
  * Type `tds` and press Enter. The window must split into four quadrants: Neovim top-left (opened on `.` — the function hard-codes `nvim .`, not `$EDITOR`), the top-right pane running `hunk diff --watch` (initially mise downloading `hunk`, then hunk's watch view or a message that there is nothing to diff), a shell prompt bottom-left, and the bottom-right pane running `opencode` (mise download, then OpenCode's TUI asking to sign in / pick a provider, or an error about credentials).
  ** Neither `hunk` nor `opencode` is installed on the stock disk; give each download up to 60 s, screenshot every few seconds, never wait longer than 5 s between actions.
  * Report what the top-right and bottom-right panes ended up showing.
  * Type `tmux kill-server` in the bottom-left pane and press Enter. Then press Super+Enter, type `cd /tmp/sq && t` + Enter, then `tdl` + Enter: describe the layout it builds and record the last line printed — the function ends with `tmux select-pane -t "$opencode_pane"` where the variable is only set by `tds`, so a `can't find pane` error is the known defect; report its exact text (or its absence).
  * Type `tmux kill-server` and press Enter.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Skipped in this guest: verifying hunk actually watches diffs and that OpenCode can be used (no credentials). Only the pane geometry, the started commands, the usage refusal and the `tdl` error are checked.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of `Usage: tds`, of the four quadrants with Neovim top-left and download/TUI output in the two right panes, and of the `tdl` result with its last line
  * If unsuccessful
  ** Screenshot of the window after `tds`, plus `tmux list-panes -F '#{pane_id} #{pane_current_command}' | sudo tee /dev/ttyS0` read via get-serial
covers: manual/15-terminal.md:31; manual/20-shell-functions.md:20; default/bash/fns/tmux:42-65; install/user/mise.sh (hunk, opencode stubs)
merged-from: 11:tmux-dev-square-tds

### editor-hotkey-and-sudoedit-open-neovim   [VM-OK]
description: Super+Shift+N launches the default editor — Neovim in its own terminal window — and `sudoedit` opens root-only files in that same Neovim through `SUDO_EDITOR` after a password prompt, refusing a wrong password first.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Shift+N. A terminal window running Neovim must open (LazyVim dashboard or an empty buffer with a status line; the window class is `org.omarchy.nvim`).
  ** If a Lazy plugin-install window appears on first start, wait for it (network) and press `q`.
  * Press `i`, type `hello from omarchy`, press Escape. The text must be in the buffer with `-- INSERT --` gone. Type `:q!` and press Enter; the window closes.
  * Press Super+Enter and type `omarchy default editor; vi --version | head -1; echo $SUDO_EDITOR` + Enter → `nvim`, a `VIM - Vi IMproved` (or vi) banner line, and `omarchy-launch-editor --inline`.
  * Type `sudoedit /etc/hosts` and press Enter. At `[sudo] password for prime:` type `wrong` and Enter → `Sorry, try again.`; then type `prime` and Enter. Neovim must open a temporary copy of `/etc/hosts` (the status line shows a `/var/tmp/hostsXXXX` path and the file's contents).
  * Type `:q!` and press Enter without changing anything → `sudoedit: /etc/hosts unchanged`. Type `sudo -k` + Enter to drop the cached credential.
  * Close the terminal with Super+W; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The editor window is tiled like any terminal; if another window is on the workspace it shares the space.
  * `sudoedit: /etc/hosts unchanged` after `:q!` is expected.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of Neovim open after the hotkey, one with the typed text, the terminal showing `nvim`, the vi banner and `omarchy-launch-editor --inline`, the `Sorry, try again.` line, Neovim on the temporary hosts copy, and the `unchanged` message
  * If unsuccessful
  ** Screenshot of the desktop after Super+Shift+N and `omarchy-launch-editor 2>&1 | sudo tee /dev/ttyS0` read via get-serial; any `editor not found` message after `sudoedit`
covers: manual/16-neovim.md:36-42; manual/18-development-tools.md:7; default/hypr/bindings/applications.lua:8; bin/omarchy-launch-editor (`--inline`); bin/omarchy-default-editor; default/bash/envs:2-3; test/acceptance.d/apps-test.sh (neovim row); test/shell.d/editor-env-test.sh
merged-from: 11:editor-hotkey-opens-neovim; 11:neovim-sudoedit

### neovim-lazyvim-basics   [VM-OK]
description: The `n` alias and the LazyVim keys the manual teaches (Space e tree, `a` to add a file, Space Space finder, Shift+H/L buffer tabs, Space b d) work in the shipped omarchy-nvim config, so the editor is usable the way the manual describes it.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter and type `mkdir -p /tmp/nv && cd /tmp/nv && echo one > one.txt && echo two > two.txt && n` then Enter. Neovim must open on the directory (a file explorer listing `one.txt` and `two.txt`, or the LazyVim dashboard).
  ** If a plugin-install window appears on first start, wait for it (network) and press `q`.
  * Press Space and wait one second: a which-key popup listing leader commands must appear. Press Escape.
  * Press Space then `e`. The file tree must be shown/focused on the left listing `one.txt` and `two.txt`. With the tree focused press `a`, type `three.txt` and press Enter → `three.txt` appears in the tree.
  * Press Ctrl+W then `w` to hop to the editor side. Press Space Space, type `two`, press Enter → `two.txt` opens showing `two`.
  * Press Space Space, type `one`, Enter (opens `one.txt`). Press Shift+H then Shift+L: the active buffer tab must move between `one.txt` and `two.txt`.
  * Press Space then `b` then `d`: the current buffer closes (one fewer tab). Type `:qa!` and press Enter to leave.
  * In the terminal type `n one.txt` and press Enter: Neovim opens with `one` in the buffer; type `:q!` Enter. Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Keys are lowercase unless stated; send Space as `<SPACE>`.
  * If the tree is not focused when pressing `a`, press Space e twice to toggle it back, or click inside it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the which-key popup, the tree with `three.txt`, the buffer tabs after Shift+H/L, and `n one.txt` showing `one`
  * If unsuccessful
  ** Screenshot of the state where a key did nothing or errored, and `:messages` output
covers: manual/16-neovim.md:13-38; manual/19-shell-tools.md:11,25; default/bash/aliases:57
merged-from: 11:neovim-lazyvim-basics

### fzf-ff-eff-history-and-man-through-bat   [VM-OK]
description: The file-open helpers work end to end — `n` opens Neovim on a directory, `ff`/`eff` fuzzy-find a file with a bat preview and open it, `sff` refuses to run without a destination — and Ctrl+R searches history through fzf while `man` renders through bat, all with graceful cancel.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter. Type `mkdir -p /tmp/fz && cd /tmp/fz && printf 'def hello\n  puts 1\nend\n' > a.rb && printf 'alpha\nbeta\n' > notes.txt` + Enter.
  * Type `n` + Enter → Neovim opens with a directory listing of `/tmp/fz`. Type `:qa!` Enter.
  * Type `ff` + Enter. fzf must open listing `a.rb` and `notes.txt` with a preview pane on the right showing the highlighted file's contents with line numbers (bat). Move to `a.rb`: the preview shows `def hello` with syntax colouring. Press Escape: it closes, the prompt shows `✗`, nothing else happened.
  * Type `ff` + Enter and select `notes.txt` with Enter → `notes.txt` is printed and the prompt returns. Type `eff` + Enter and press Enter on `notes.txt` → Neovim opens `notes.txt` showing `alpha`/`beta`; type `:q` Enter.
  * Type `sff; echo rc=$?` + Enter → `Usage: sff <destination> (e.g. sff host:/tmp/)` and `rc=1`.
  * Type `echo unique-history-marker-42` + Enter. Press Ctrl+R and type `marker-42`: an fzf history list shows the echo command. Press Enter: the command is placed on the prompt; Enter again runs it.
  * Type `man ls` + Enter: the manual page must be rendered with colour (bat as pager) — coloured headings/options and the header `LS(1)`. Press `q`. Type `man no-such-page-zz; echo rc=$?` → `No manual entry for no-such-page-zz`, `rc=16`. Type `MANPAGER=cat man ls | head -3` → plain uncoloured text (the pager is what adds colour). Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * fzf's prompt is `>` at the bottom-left; the preview pane is on the right half. fzf filters as you type; type `not` if the list is long.
  * If `man` shows a `bat`/`col` "not found" error instead of a coloured page, that is the failure to capture.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the Neovim explorer, the `ff` view with the bat preview of `a.rb`, Neovim on `notes.txt` via `eff`, the `sff` usage line with `rc=1`, the Ctrl+R list containing the marker command, the coloured `LS(1)` page, the missing-page error with `rc=16`, and the plain `MANPAGER=cat` variant
  * If unsuccessful
  ** Screenshot of the terminal after `ff` (e.g. `bat: command not found`, an unstyled preview, fzf not found), Neovim failing to start, or an uncoloured/pager-error man page
covers: manual/19-shell-tools.md:5-13,41-45; default/bash/aliases:9-13 (n, ff, eff, sff); default/bash/init:21-28 (fzf); default/bash/envs:9-13 (MANPAGER, MANROFFOPT, BAT_THEME)
merged-from: 11:fzf-ff-and-history-search; 41:shell-file-open-helpers; 41:man-pages-render-through-bat

### zoxide-cd-jump-miss-and-dotdot   [VM-OK]
description: `cd` goes through zoxide so a previously visited directory can be reached by a fragment of its name (printing where it landed), an unknown target gives `Error: Directory not found` instead of silently staying put, and `..`/`...` still climb the tree.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter. Type `type cd` + Enter → `cd is aliased to 'zd'`.
  * Type `mkdir -p /tmp/zx/alpha/beta && cd /tmp/zx/alpha/beta && cd && pwd` + Enter → `/home/prime` (bare `cd` goes home).
  * Type `cd ~/.config/omarchy && pwd` + Enter → `/home/prime/.config/omarchy`; then `cd` + Enter and `pwd` → `/home/prime`.
  * Type `cd beta && pwd` + Enter → a folder glyph followed by `/tmp/zx/alpha/beta`, then pwd confirms the jump.
  * Type `... && pwd && .. && pwd` + Enter → `/tmp/zx` then `/tmp`.
  * Type `cd oma` + Enter → the jump marker line (icon followed by `/home/prime/.config/omarchy`); `pwd` + Enter confirms `/home/prime/.config/omarchy`.
  * Type `cd no-such-directory-xyz; echo rc=$?` + Enter → `Error: Directory not found` and `rc=1`; `pwd` + Enter → still `/home/prime/.config/omarchy`. Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * zoxide only learns directories visited through `cd`; the first `cd` into each directory is what teaches it.
  * A literal `\U000F17A9` instead of a folder glyph is a locale bug; report it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the alias line, the home `pwd`, the jump lines with glyph and path after `cd beta` and `cd oma`, the two pwd lines after `...` and `..`, and the `Error: Directory not found` line with `rc=1` and unchanged pwd
  * If unsuccessful
  ** Screenshot of `cd beta` failing after the visit, of the raw escape text, and `zoxide query -l | sudo tee /dev/ttyS0` read via get-serial
covers: manual/19-shell-tools.md:15-19; default/bash/aliases:17-34,41-43 (zd, dotdot); default/bash/init:9-11 (zoxide)
merged-from: 11:zoxide-cd-jump-and-miss; 41:shell-zoxide-cd-and-dotdot

### eza-listing-aliases   [VM-OK]
description: `ls`, `lsa`, `lt` and `lta` are the eza views the manual describes (icons, long format, directories first, two-level tree, hidden files) and a bad path gives a clear error.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter. Type `mkdir -p /tmp/ez/sub/deep && cd /tmp/ez && touch .hidden sub/file sub/deep/leaf visible` + Enter.
  * Type `ls` + Enter → a long listing (permissions, size, date) with icons; `sub` listed before `visible`; `.hidden` absent.
  * Type `lsa` + Enter → same, now including `.hidden`.
  * Type `lt` + Enter → a tree two levels deep: `sub` → `deep` and `file`; `leaf` must NOT be shown (level 2 cap). Type `lta` + Enter → the tree including `.hidden`.
  * Type `type ls` + Enter → `ls is aliased to 'eza -lh --group-directories-first --icons=auto'`.
  * Type `ls /nonexistent-zz` + Enter → an eza "No such file or directory" error and the prompt shows `✗`. Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Icons render only because the terminal font is a Nerd Font; if they show as boxes, report it. Plain coreutils output (no icons, no grouping) means eza is missing; report it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of each listing, the `type ls` line, and the error for the bad path
  * If unsuccessful
  ** Screenshot of the deviating listing (e.g. GNU ls output) or a hang
covers: manual/19-shell-tools.md:29-33; default/bash/aliases:2-7 (eza block)
merged-from: 11:eza-listing-aliases; 41:shell-eza-ls-aliases

### compress-decompress-roundtrip   [VM-OK]
description: `compress` and `decompress` wrap tar so a directory round-trips through a `.tar.gz` (trailing slash stripped from the name), and both report a tar error when given nothing or a missing file instead of writing a nameless archive.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter. Type `mkdir -p /tmp/cz/data && cd /tmp/cz && echo payload > data/file.txt` + Enter.
  * Type `compress data/ && ls` + Enter → `data  data.tar.gz` (the trailing slash must not produce `data/.tar.gz`).
  * Type `mkdir out && cd out && decompress ../data.tar.gz && cat data/file.txt` + Enter → `payload`.
  * Type `cd /tmp/cz && compress; echo rc=$?; ls -a | grep tar` + Enter → a tar error (`tar: Cowardly refusing to create an empty archive` or `Cannot stat`), a non-zero `rc`, and only `data.tar.gz` listed — record whether a stray `.tar.gz` was created.
  * Type `decompress missing.tar.gz` + Enter → `tar: missing.tar.gz: Cannot open: No such file or directory`.
  * Type `type compress decompress` + Enter → a function and an alias. Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The negative results are printed lines; screenshot right after each command.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the listing with `data.tar.gz`, `payload` after decompress, and both error lines with return codes
  * If unsuccessful
  ** Screenshot of a silent no-arg compress, a stray archive, or a decompress that does nothing; `ls -la /tmp/cz`
covers: manual/20-shell-functions.md:5-8; default/bash/fns/compression
merged-from: 11:compress-decompress-roundtrip; 41:shell-compress-decompress

### drive-helpers-usage-and-declined-format   [VM-OK]
description: The destructive drive helpers `iso2sd` and `format-drive` show usage and the available-drive list when misused, find no removable drive in the guest, and `format-drive` does nothing when the confirmation is declined — no disk is ever touched.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter. Type `iso2sd; echo rc=$?` + Enter → `Usage: iso2sd <input_file> [output_device]`, an `Example:` line, `rc=1`.
  * Type `touch /tmp/fake.iso && iso2sd /tmp/fake.iso; echo rc=$?` + Enter → `No SD drives found and no drive specified`, `rc=1` (there are no `/dev/sd*` devices in this guest). No sudo prompt must appear.
  * Type `format-drive` + Enter → `Usage: format-drive <device> <name>`, an example, then `Available drives:` followed by `/dev/vda` (and possibly `/dev/zram0`).
  * Type `format-drive /dev/vda` + Enter (one argument) → the same usage + drive list; nothing else.
  * Type `format-drive /dev/null Probe` + Enter → `WARNING: This will completely erase all data on /dev/null and label it 'Probe'.` and `Are you sure you want to continue? (y/N):` — type `n` and Enter. The prompt returns with no further output.
  * Type `lsblk` + Enter → the vda partitions unchanged. Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * NEVER answer `y` (or anything but `n`/Ctrl+C); `/dev/null` is used only to reach the confirmation prompt safely — declining runs nothing.
  * If a `/dev/sd*` device unexpectedly exists, stop the iso2sd step at the drive picker and press Escape.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of each usage output, the "No SD drives found" line, the drive list showing `/dev/vda`, the WARNING prompt, the declined confirmation, and `lsblk` unchanged
  * If unsuccessful
  ** Screenshot of any sudo/dd/parted activity (a serious failure) and `lsblk`
covers: manual/20-shell-functions.md:10-14; default/bash/fns/drives
merged-from: 11:drive-helpers-safe-paths; 41:shell-drive-helpers-usage-and-abort

### git-worktree-ga-gd   [VM-OK]
description: `ga <branch>` creates a sibling worktree named `<repo>--<branch>` on a new branch and enters it, `gd` asks before removing it and refuses to act on a directory that is not a worktree, and `ga` without a branch prints usage.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter. Type `mkdir -p /tmp/wt/repo && cd /tmp/wt/repo && git init -q && git config user.email t@e.st && git config user.name T && git commit -q --allow-empty -m init` + Enter.
  * Type `ga; echo rc=$?` + Enter → `Usage: ga [branch name]`, `rc=1`.
  * Type `ga feature` + Enter. git prints `Preparing worktree (new branch 'feature')`; `pwd` + Enter → `/tmp/wt/repo--feature`; `git branch --show-current` + Enter → `feature`.
  * Type `gd` + Enter → a gum confirmation `Remove worktree and branch?`. Choose **No**. `pwd` + Enter → still `/tmp/wt/repo--feature`.
  * Type `gd` + Enter → choose **Yes**. It prints `Deleted branch feature …`; `pwd` + Enter → `/tmp/wt/repo`; `ls /tmp/wt` + Enter → only `repo`.
  * Type `cd /tmp/wt && gd` + Enter → choose Yes: because the directory name has no `--`, nothing must be removed and `ls` still shows `repo`. Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * `mise trust` inside `ga` may print a line about trusting the directory; that is fine.
  * gum confirm: Left/Right moves, Enter chooses; the highlighted button is the selection.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the usage line, the worktree creation with `pwd`, the confirm dialog and the state after No, the deletion output with `pwd` back in `repo`, and the no-op on a non-worktree directory
  * If unsuccessful
  ** Screenshot of a worktree removed without confirmation or `gd` deleting a non-worktree directory; `git worktree list`
covers: manual/20-shell-functions.md:26-29; default/bash/fns/worktrees
merged-from: 11:git-worktree-ga-gd; 41:shell-worktree-ga-gd

### git-aliases-and-config-defaults   [VM-OK]
description: The git aliases and Omarchy's git config work end to end: `master` on init, a first commit that explains a missing identity, automatic upstream on push, and `co`/`br` aliases.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter and type `mkdir -p /tmp/gx && cd /tmp/gx && g init && g st` Enter.
  ** "Initialized empty Git repository" and `On branch master`.
  * Type `echo a > a && git add a && gcm first` Enter.
  ** If no identity was set at install, git prints "Please tell me who you are" (expected). Then type `git config user.name T && git config user.email t@e.com && gcm first` Enter → the commit succeeds. If an identity exists it succeeds at once; record which.
  * Type `echo b >> a && gcam second && gcad --no-edit && git log --oneline` Enter → two commits.
  * Type `git init -q --bare /tmp/gx-remote && git remote add origin /tmp/gx-remote && git push` Enter.
  ** Push succeeds and prints that `master` is set up to track `origin/master` (no `-u` needed).
  * Type `git co -b feature && git br` Enter → `* feature` above `master`.
  * Press Ctrl+D; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * `gcad` opens no editor because of `--no-edit`; if an editor opens anyway type `:q` Enter.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of `master` on init, the identity message (or immediate success), the two-commit log, the auto-upstream push text, and the branch list
  * If unsuccessful
  ** Screenshot of `main` as default, a push refused for missing upstream, or an alias not found
covers: config/git/config, default/bash/aliases (git block), install/user/git.sh
merged-from: 41:shell-git-aliases-and-defaults

### ssh-helpers-fail-fast-without-server   [VM-OK]
description: With no SSH server reachable, the `ssh` wrapper passes a fast connection failure straight through (no reconnect loop, terminal modes intact) and the `fip`/`dip`/`lip` forwarders report usage and no-forward states cleanly, so a typo gives a message instead of a hung ssh.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter. Type `type ssh | head -1; fip; dip; lip` + Enter → `ssh is a function`, `Usage: fip <host> <port1> [port2] ...`, `Usage: dip <port1> [port2] ...`, `No active forwards`.
  * Type `fip somehost` + Enter → the same fip usage (needs at least one port). Type `dip 3000` + Enter → `No forwarding on port 3000`.
  * Type `fip 127.0.0.1 3000; lip` + Enter. Because no sshd listens locally it fails fast with `ssh: connect to host 127.0.0.1 port 22: Connection refused`, prints no `Forwarding` line, and `lip` says `No active forwards`.
  * Type `ssh -o ConnectTimeout=3 127.0.0.1; echo rc=$?` + Enter → the same refusal and `rc=255`, with the prompt back immediately and **no** `Connection lost. Reconnecting` line.
  * Type `ssh -o ConnectTimeout=3 127.0.0.1 true; echo rc=$?` + Enter → same refusal, `rc=255`, no retry (a remote command is never retried).
  * Move the mouse across the terminal and type `echo still typing fine` + Enter → echoes normally; no escape junk appears (the wrapper restored terminal modes). Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * A reconnect loop only triggers for interactive sessions that lasted 30 s and exited 255; it cannot be provoked without a server, so only the pass-through is checked here (see `ssh-wrapper-reconnects-after-drop`).
  * If sshd was enabled earlier in this session (Setup → Security → SSHD) a password prompt appears instead; press Ctrl+C and note it — nothing here should connect.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the function line and usage lines, the refused forward without a `Forwarding` line, both `rc=255` lines with no Reconnecting text, and the clean echo afterwards
  * If unsuccessful
  ** Screenshot of a `Reconnecting` loop (press Ctrl+C to stop it), a hang beyond 15 s, or mouse escape junk in the prompt; `pgrep -af 'ssh.*-L'`
covers: manual/20-shell-functions.md:37-49; default/bash/fns/ssh-port-forwarding; default/bash/fns/ssh-reconnect; install/config/ssh-keepalive.sh; test/shell.d/ssh-reconnect-test.sh
merged-from: 11:ssh-port-forward-helpers; 41:shell-ssh-helpers-without-server; 11:ssh-wrapper-no-retry-on-refused

### ssh-wrapper-reconnects-after-drop   [VM-OK]
description: The shell's `ssh` wrapper reconnects an interactive session that drops after it was established (30 s or older), resets stray terminal modes, never replays a remote command or a fast failure, and Ctrl+C stops the retry loop — proven against a local sshd set up and torn down inside the test.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter and type `ssh-keygen -t ed25519 -N '' -f ~/.ssh/testkey -q && omarchy-setup-security-sshd --key="$(cat ~/.ssh/testkey.pub)"` + Enter (password `prime`). It must end with `Perfect! The SSH server is running and your key is authorized.`
  * Fast failure: type `ssh -o ConnectTimeout=2 nonexistent.invalid; echo "exit=$?"` + Enter → fails once, no `Connection lost`, non-zero exit.
  * Remote command: type `ssh -i ~/.ssh/testkey -o StrictHostKeyChecking=no localhost 'exit 255'; echo "exit=$?"` + Enter → `exit=255` with no reconnect attempt.
  * Interactive drop: type `ssh -i ~/.ssh/testkey -o StrictHostKeyChecking=no localhost` + Enter, then inside the session type `sleep 40` + Enter (the wrapper only reconnects sessions older than 30 s). Open a second terminal with Super+Enter and type `sudo pkill -f 'sshd: prime'` + Enter (password `prime`).
  ** The first terminal prints `Connection lost` and reconnects, presenting a fresh remote prompt. Type `exit`; the terminal must be usable (no stuck mouse/alt-screen modes).
  * Ctrl+C stops the loop: repeat the drop, but in the second terminal type `sudo systemctl stop sshd` + Enter before the `pkill`; while the first terminal shows `Connection lost` and retries, press Ctrl+C there → the prompt returns; type `echo "exit=$?"` → `exit=130`.
  * In the second terminal type `sudo systemctl start sshd` + Enter, then `omarchy-remove-security-sshd` + Enter and answer **Yes** to removing authorized keys; `systemctl is-enabled sshd` → `disabled`. Type `rm -f ~/.ssh/testkey ~/.ssh/testkey.pub` + Enter.
  * Close both terminals with Super+W; the machine is as it started.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The wrapper is a bash function from Omarchy's shell functions; run these from a normal interactive terminal, not a script.
  * Use `mouse move` to hover the first terminal before typing Ctrl+C so the keystroke lands there.
  * The 40 s sleep is eight 5 s screenshots; never a single long sleep.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the sshd setup ending in `Perfect!`, the fast failure (no reconnect), `exit=255` for the remote command, `Connection lost` followed by a new remote prompt after the kill, Ctrl+C stopping the retry loop with `exit=130`, and `disabled` after the revert
  * If unsuccessful
  ** Screenshot of a reconnect after a fast failure or remote command, no reconnect after a real drop, or a terminal left with broken modes
  ** Output of `omarchy-version`
covers: default/bash/fns/ssh-reconnect; test/shell.d/ssh-reconnect-test.sh; manual/20-shell-functions.md; bin/omarchy-setup-security-sshd; bin/omarchy-remove-security-sshd
merged-from: 52:ssh-reconnect-after-drop

### rsync-watchers-rsw-lsw-dsw   [VM-OK]
description: `rsw` starts a background sync-on-change watcher whose effect is visible in the destination, `lsw` lists it, `dsw` stops it so later changes no longer sync, and wrong usage prints help.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter and type `rsw; lsw; dsw; rsw /tmp/only-one` Enter.
  ** `Usage: rsw <source> <destination>`, `No active watches`, `No active watches`, and the usage again for the single argument.
  * Type `mkdir -p /tmp/rs/src && echo one > /tmp/rs/src/one.txt && rsw /tmp/rs/src /tmp/rs/dst` Enter → `Watching /tmp/rs/src -> /tmp/rs/dst`. Type `sleep 2; ls /tmp/rs/dst` → `one.txt` (initial sync).
  * Type `echo two > /tmp/rs/src/two.txt; sleep 3; ls /tmp/rs/dst` Enter → `one.txt  two.txt` (change picked up).
  * Type `lsw` Enter → one line `<pid>: /tmp/rs/src -> /tmp/rs/dst`.
  * Type `dsw; echo three > /tmp/rs/src/three.txt; sleep 3; ls /tmp/rs/dst` Enter.
  ** `Stopped watch (pid N)` and the listing still shows only `one.txt two.txt`.
  * Type `lsw` Enter → `No active watches`. Press Ctrl+D; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If `lsw` shows nothing right after `rsw`, the watcher died (inotifywait missing); report it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the usage lines, the Watching line, the synced listing, the lsw entry, and the unchanged listing after dsw
  * If unsuccessful
  ** Screenshot of files not syncing or `lsw` empty after `rsw`; `pgrep -af rsw-watch`
covers: default/bash/fns/rsyncing; manual/20-shell-functions.md:31-35
merged-from: 41:shell-rsync-watchers; 11:rsync-watchers

### readline-history-prefix-and-tab-cycling   [VM-OK]
description: Omarchy's inputrc makes Up/Down search history by prefix, Tab cycle through completions after completing the common prefix, and completion ignore case and hidden files.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter and type `echo first-a` Enter, `echo first-b` Enter, `ls /tmp` Enter.
  * Type `echo` (no Enter) and press Up twice.
  ** The line becomes `echo first-b`, then `echo first-a`; `ls /tmp` is skipped. Press Ctrl+C.
  * Type `cd ~/down` and press Tab once → `cd ~/Downloads/` despite the lowercase d. Press Ctrl+C.
  * Type `touch /tmp/ab1 /tmp/ab2 /tmp/.abh` Enter, then type `ls /tmp/ab` and press Tab, Tab, Tab, Shift+Tab.
  ** First Tab lists `ab1 ab2`; the next Tabs cycle the line to `/tmp/ab1`, `/tmp/ab2`; Shift+Tab goes back. `.abh` never appears. Press Ctrl+C.
  * Press Ctrl+D; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Screenshot after every single Tab so the cycling is visible.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the prefix recall, the case-insensitive completion, and the cycling sequence without the hidden file
  * If unsuccessful
  ** Screenshot of Up recalling `ls /tmp` or Tab listing without cycling
covers: default/bash/inputrc, default/bash/rc
merged-from: 41:readline-inputrc-behaviour

### starship-prompt-path-git-and-error-state   [VM-OK]
description: The Starship prompt shows a truncated path, the git branch and status glyphs inside a repo, and turns to `✗` after a failing command and back to `❯` after a success; editing `~/.config/starship.toml` changes the prompt in new terminals, and a broken file makes Starship warn and fall back instead of breaking the shell.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter and screenshot the prompt (a cyan `❯` after the directory, a blank line before it). Type `mkdir -p /tmp/sp/deep/er && cd /tmp/sp/deep/er` Enter.
  ** The prompt shows `…/deep/er` followed by `❯`.
  * Type `git init -q /tmp/repo1 && cd /tmp/repo1 && touch a` Enter.
  ** Prompt shows `repo1` in bold cyan, `master` in italic cyan and a `?` (untracked).
  * Type `git add a && git -c user.name=t -c user.email=t@t commit -qm init` Enter: the `?` disappears.
  * Type `false` Enter: the prompt character becomes `✗`. Type `true` Enter: back to `❯`.
  * Type `sed -i 's/^add_newline = true/add_newline = false/; s/success_symbol = .*/success_symbol = "[→](bold green)"/' ~/.config/starship.toml && grep -n 'add_newline\|success_symbol' ~/.config/starship.toml` Enter, then open a new terminal with Super+Enter.
  ** The prompt character is now a green `→` and there is no blank line between commands.
  * Break the file: type `echo 'this is not = toml = at all [' >> ~/.config/starship.toml` Enter; open another terminal with Super+Enter.
  ** Starship prints a warning such as `[WARN] - (starship::config): Unable to parse the config file` and shows its built-in default prompt (typically `❯` in green/red, directory in bold cyan); the shell itself works (`echo ok`).
  * Restore: type `cp /usr/share/omarchy/config/starship.toml ~/.config/starship.toml` Enter; open a new terminal → the original cyan `❯` prompt with the blank line. Close all terminals with Super+W; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * A box where a glyph should be means the Nerd Font is missing; report it.
  * Keep the terminals tiled so the prompt styles are visible in one screenshot.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the truncated path prompt, the repo prompt with branch and `?`, the clean repo prompt, `✗` after `false`, the modified prompt (green `→`, no blank line), the warning + fallback prompt with `echo ok`, and the restored prompt
  * If unsuccessful
  ** Screenshot of a prompt without branch/status or with rendering errors, a terminal that fails to open or a shell error; `cat ~/.config/starship.toml | sudo tee /dev/ttyS0` read via get-serial
covers: config/starship.toml, default/bash/init, config/git/config; manual/40-prompt.md
merged-from: 41:starship-prompt-git-and-error-state; 12:starship-prompt-edit-and-invalid

### shell-env-defaults-and-bashrc-additions   [VM-OK]
description: Every interactive shell carries Omarchy's defaults — `EDITOR`/`SUDO_EDITOR`/`BROWSER`/`TERMINAL` point at the launchers, a UTF-8 locale is always set, inherited values are kept — while the session deliberately leaves `BROWSER` unset so a browser's own "set as default" works; and aliases/exports appended to `~/.bashrc` are picked up by every new terminal.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter and type `echo "$EDITOR | $BROWSER | $TERMINAL | $SUDO_EDITOR | $OMARCHY_PATH | $LANG"` Enter.
  ** `omarchy-launch-editor --inline | omarchy-launch-browser | xdg-terminal-exec | omarchy-launch-editor --inline | /usr/share/omarchy | <a UTF-8 locale>`.
  * Type `systemctl --user show-environment | grep -E '^(BROWSER|EDITOR)='` Enter → `EDITOR=…` is present; no `BROWSER=` line.
  * Type `env -u LANG bash -ic 'printf "%s \U000F17A9\n" "$LANG"' 2>/dev/null` Enter → a UTF-8 locale followed by a folder glyph, not a literal `\U000F17A9`.
  * Type `BROWSER=firefox bash -ic 'echo $BROWSER'; EDITOR=helix bash -ic 'echo $EDITOR'` Enter → `firefox`, `helix` (inherited values kept).
  * Type `xdg-settings set default-web-browser chromium.desktop; echo s=$?; xdg-settings get default-web-browser` Enter → `s=0`, `chromium.desktop`.
  * Type `echo "alias probehello='echo hello-from-bashrc'" >> ~/.bashrc && echo 'export PROBE_VAR=set-in-bashrc' >> ~/.bashrc` Enter. Close this terminal with Super+W and open a new one with Super+Enter. Type `probehello; echo $PROBE_VAR` Enter → `hello-from-bashrc`, `set-in-bashrc`.
  * Restore: type `sed -i '/probehello/d; /PROBE_VAR/d' ~/.bashrc && grep -c probehello ~/.bashrc` Enter → `0`. Press Ctrl+D; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If a line wraps, widen the terminal with Super+F (fullscreen) before screenshotting; press Super+F again to restore.
  * `bash -ic` starts an interactive shell so Omarchy's env files are sourced. The Omarchy `.bashrc` sources other files; appending at the end is safe.
  * The glyph is a folder icon from the Nerd Font; any visible symbol counts, a backslash sequence does not.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the six-value line, no `BROWSER=` in the session environment, the UTF-8 locale with the glyph, the inherited values, `xdg-settings set` succeeding, and `probehello`/`echo $PROBE_VAR` in the new terminal
  * If unsuccessful
  ** Screenshot of a mismatched variable, an empty LANG, a literal `\U000F17A9`, a session `BROWSER=`, `xdg-settings set` refusing, or `command not found` for the alias with `tail ~/.bashrc`
covers: default/bash/envs; default/bash/env-bootstrap; default/uwsm/default; default/uwsm/env.d/10-omarchy; etc/profile.d/omarchy.sh; test/shell.d/{editor-env,browser-env,locale-env}-test.sh; manual/15-terminal.md; manual/31-dotfiles.md (Adding your own shell exports, functions, and aliases)
merged-from: 41:shell-env-defaults; 51:env-defaults-browser-editor-locale; 12:bashrc-alias-survives-new-terminal

### lazygit-launch-stage-and-commit   [VM-OK]
description: lazygit starts with Omarchy's (intentionally empty) config inside a repository, lets the user stage with Space and commit with `c`, shows its keybinding help, and declines to create a repo when started outside one instead of crashing.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter. Type `mkdir -p /tmp/lg-not-git && cd /tmp/lg-not-git && lazygit` + Enter. lazygit must ask whether to initialise a repository (`No valid git repository … Would you like to initialize?`) — answer No / press `n` or Escape; it exits. Type `ls -a` + Enter → no `.git`.
  * Type `mkdir -p /tmp/lg && cd /tmp/lg && git init -q && git config user.email t@e.st && git config user.name T && echo hi > a.txt && lazygit` + Enter.
  ** lazygit opens with panels Status / Files / Branches / Commits / Stash on the left and a diff/log on the right; the Files panel lists `?? a.txt`.
  * With the Files panel focused press Space: the entry becomes `A  a.txt` (staged, green).
  * Press `c`, type `first commit`, press Enter. The Commits panel must now list `first commit`.
  * Press `?`: the keybindings overlay opens. Press Escape. Press Tab a few times: focus cycles across panels (the highlighted border moves).
  * Press `q` to quit. Type `git log --oneline` + Enter → one line `first commit`. Press Ctrl+D; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If the Files panel is not focused at start, press `2` or click it.
  * The repo-local user.name/email avoids a "please tell me who you are" failure when the minted user has no global identity.
  * The Omarchy lazygit config is intentionally empty; any config error on start is a failure.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the not-a-repo prompt declined and `ls -a` without `.git`, `?? a.txt`, the staged `A  a.txt`, the commit in the Commits panel, the `?` overlay, and `git log --oneline`
  * If unsuccessful
  ** Screenshot of a config parse error or crash on start, or the state where a key did nothing and lazygit's error bar
covers: manual/21-tuis.md:3-9; manual/18-development-tools.md:37; install/omarchy-base.packages (lazygit); config/lazygit/config.yml
merged-from: 11:lazygit-stage-and-commit; 41:lazygit-launch

### btop-omarchy-config   [VM-OK]
description: btop starts with Omarchy's config (theme following the desktop, vim keys, four rounded boxes), keeps the `current` theme after its save-on-exit, and is reached from the terminal, not the launcher.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter and type `btop` Enter.
  ** Four boxes (cpu, mem, net, proc) with rounded corners and braille graphs in the desktop theme's colours; a clock at the top.
  * Press `j` twice then `k` → the process selection moves down/up.
  * Press `q` → btop exits. Type `grep '^color_theme' ~/.config/btop/btop.conf` Enter → `"current"` (kept after the save-on-exit).
  * Press Super+Alt+Space, type `btop` → no launcher entry. Press Escape.
  * Press Ctrl+D; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Default btop colours (blue/white) instead of the desktop theme mean the `current` theme is missing; report it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of btop with theme colours and four boxes, the moved selection, the `color_theme` line, and the empty launcher search
  * If unsuccessful
  ** Screenshot of default-coloured btop, `j`/`k` not moving, or a launcher entry
covers: config/btop/btop.conf, default/omarchy/launcher.hides
merged-from: 41:btop-omarchy-config

### terminal-toolchain-runnable   [VM-OK]
description: The bundled terminal toolchain (git, tmux, mise, fastfetch, headless Neovim) runs, and a bad mise subcommand fails cleanly — these are what a developer touches in the first minute.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter (note: no fastfetch banner is printed on open; it is reached via `Omarchy Menu → About` or by hand).
  * Type `git --version; tmux -V; mise --version` and press Enter. Three version lines must print.
  * Type `timeout 10 fastfetch --pipe false | head -20` and press Enter. System information (OS, kernel, shell) must print.
  * Type `nvim --headless '+qa' && echo NVIM-OK` and press Enter. It must print `NVIM-OK`.
  * Type `mise not-a-command; echo rc=$?` and press Enter. It must print an error and a non-zero rc.
  * Close the terminal with Super+W. The desktop must look exactly as at the start.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * fastfetch prints colour blocks; only the text lines matter.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot with three version lines, fastfetch output, `NVIM-OK`, and the mise error with non-zero rc
  * If unsuccessful
  ** Screenshot of the command that failed
covers: test/acceptance.d/system-test.sh:102-111
merged-from: 50:system-terminal-tools-runnable

### default-apps-show-set-and-reject   [VM-OK]
description: The `default` group's read side reports the stock defaults (browser chromium, editor nvim, terminal foot, no agent) and the MIME handlers match; Setup → Defaults shows the ✓ on exactly those rows (none in Agent); choosing an already-installed default from the CLI or the menu persists at once with a toast; unknown choices are refused without changing anything.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy default browser; omarchy default editor; omarchy default terminal; omarchy default agent; echo "agent-exit=$?"` → `chromium`, `nvim`, `foot`, nothing for the agent, `agent-exit=0` (record the words if the build differs). Type `xdg-mime query default x-scheme-handler/http; xdg-mime query default inode/directory` → `chromium.desktop`, `org.gnome.Nautilus.desktop`.
  * Type `omarchy default --help` → `Default commands — Default application selection:` with four rows and their option lists.
  * Press Super+Space → Setup → Defaults → Browser: the ✓ is on `Chromium` only. Escape. Setup → Defaults → Editor: ✓ on `Neovim` only. Setup → Defaults → Terminal: ✓ on `Foot` only. Setup → Defaults → Agent: NO ✓ on any row. Escape each time.
  ** The submenus list every option, installed or not; do not click any row other than `Foot`/`Neovim` below — the others start a package download.
  * Type `omarchy default editor nvim; echo "exit=$?"` → toast `Neovim is now the default editor`, `exit=0`; `cat ~/.local/state/omarchy/defaults/editor` → `nvim`.
  * Press Super+Space → Setup → Defaults → Terminal → click `Foot` with the mouse → toast `Foot is now the default terminal`, no installer window. Type `cat ~/.config/xdg-terminals.list; omarchy default terminal` → two comment lines then `foot.desktop`, and `foot`. Press Super+Enter → a foot window opens (`echo $TERM` prints `xterm-256color`); close it with Super+W.
  * Type `omarchy default editor bogus; echo "exit=$?"` → `Usage: omarchy-default-editor <code|cursor|zed|sublime_text|helix|vim|emacs|nvim>`, `exit=1`; `cat ~/.local/state/omarchy/defaults/editor` still `nvim`. Type `omarchy default terminal bogus; echo "exit=$?"` and `omarchy default browser bogus; echo "exit=$?"` → the matching usage lines, `exit=1` each.
  * Press Super+Space → Setup → Defaults → Editor; `Neovim` still carries the ✓ (reopen the submenu twice before judging). Escape. Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The ✓ is appended to the row label; zoom the screenshot if the glyph is small. Menu guards paint from the previous open — reopen twice before asserting a ✓ moved.
  * double checking your mouse position before clicking can be useful to prevent failure.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the four printed defaults and the two MIME handlers, each Defaults submenu with the ✓ where expected (none in Agent), both toasts, the file contents, and the three usage refusals with `exit=1`
  * If unsuccessful
  ** a ✓ on the wrong row, two ✓ in one submenu, a mismatch between CLI and menu, a floating installer opening for an installed app, or the defaults file changed by a rejected value
covers: bin/omarchy-default-browser:13-25; bin/omarchy-default-editor:14-22; bin/omarchy-default-terminal:13-24; bin/omarchy-default-agent:15-24; default/omarchy/omarchy-menu.jsonc:136-173; default/xdg-terminal-exec/hyprland-xdg-terminals.list; test/shell.d/default-apps-test.sh
merged-from: 20:default-show-current-and-agent-unset; 20:default-set-editor-terminal-and-reject

### default-editor-switch-to-vim-installs   [VM-OK] [NET]
description: Setup → Defaults → Editor changes which editor the config menu entries open, installing it if missing (vim, small download), reports the change with a notification, refuses an unknown name, and can be switched back to Neovim.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Omarchy Menu with Super+Space → Setup → Defaults → Editor.
  ** Rows Neovim (✓), VSCode, Cursor, Zed, Sublime Text, Helix, Vim, Emacs — every option is listed whether installed or not.
  * Select Vim.
  ** If vim is not installed a floating terminal installs it (sudo prompt: `prime`; small download) and closes on Done. Then a notification `Vim is now the default editor` appears.
  * Open a terminal (Super+Enter) and run `omarchy default editor` → `vim`; `cat ~/.local/state/omarchy/defaults/editor` → `vim`.
  * Open the Omarchy Menu → Setup → Monitors.
  ** The editor that opens is Vim (plain vim status line, no LazyVim dashboard). Quit with `:q`.
  * Run `omarchy default editor nope; echo exit=$?` → `Usage: omarchy-default-editor <code|cursor|zed|sublime_text|helix|vim|emacs|nvim>` and `exit=1`; `omarchy default editor` still says `vim`.
  * Restore: Omarchy Menu → Setup → Defaults → Editor → Neovim; notification `Neovim is now the default editor`; `omarchy default editor` prints `nvim`. Close the terminal with Super+W.
  ** vim stays installed afterwards; end with `stop` if the disk must remain pristine.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If vim is already present no terminal appears; only the notification.
  * Reopen the Editor submenu twice before asserting where the ✓ sits.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the Editor submenu with ✓ on Neovim, the `Vim is now the default editor` notification, and vim opened by Setup → Monitors
  ** Screenshot of the usage/`exit=1` for a bad name and the restored `nvim`
  * If unsuccessful
  ** the install terminal output or the missing notification, and `./client get-serial`
covers: manual/31-dotfiles.md (Setup → Defaults → Editor), bin/omarchy-default-editor, bin/omarchy-launch-editor, omarchy-menu.jsonc setup.default.editor.*
merged-from: 12:default-editor-switch-to-vim

### files-hotkeys-cwd-preview-and-text-opens-neovim   [VM-OK]
description: Super+Shift+F opens Files, Super+Shift+Alt+F opens it in the active terminal's directory, Ctrl+L accepts a typed path, Space previews a file, and double-clicking a text file opens it in the default editor (Neovim) — the everyday file-manager flow with its MIME defaults.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Shift+F. A Nautilus window must open on the home folder (sidebar with Home, Documents, Downloads…; a `Work` folder in the main pane).
  ** GTK apps render oversized at 1× (`GDK_SCALE=2` is fixed) — expected, not a bug.
  * Close it (Super+W). Press Super+Enter, type `mkdir -p /tmp/nfm && cd /tmp/nfm && echo preview me > note.txt && xdg-mime query default text/plain` + Enter; record the handler printed (Neovim's desktop entry is expected).
  * With the terminal focused press Super+Shift+Alt+F. Nautilus must open **in `/tmp/nfm`** showing `note.txt` (path bar reads `/tmp/nfm` or `tmp › nfm`).
  * Press Ctrl+L, type `/usr/share/omarchy` and Enter: the view changes to that directory (folders like `bin`, `themes`, `default`).
  * Press Alt+Left (back) to return to `/tmp/nfm`, click `note.txt` once and press Space: a quick-preview popup (Sushi) shows `preview me`. Press Space again to close it.
  * Double-click `note.txt`: it must open in Neovim in a terminal window (plain text → Neovim). Type `:q!` + Enter.
  * Close Nautilus and the terminal with Super+W; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Super+Shift+Alt+F reads the cwd of the *focused* terminal; keep the terminal focused when pressing it.
  * If double-click opens a different editor, report which; the default handler for text/plain is expected to be Neovim.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of Nautilus on home, on `/tmp/nfm`, on `/usr/share/omarchy` after Ctrl+L, the Sushi preview, and Neovim with `preview me`
  * If unsuccessful
  ** Screenshot of the wrong directory / missing preview and the `xdg-mime query default text/plain` output
covers: manual/22-guis.md:3-9; default/hypr/bindings/applications.lua:4-5; bin/omarchy-launch-nautilus; bin/omarchy-launch-nautilus-cwd; bin/omarchy-cmd-terminal-cwd; install/omarchy-base.packages (nautilus, sushi)
merged-from: 11:files-nautilus-hotkeys

### video-double-click-opens-mpv   [VM-PARTIAL]
description: Double-clicking a video in Files opens it in mpv (the default handler for `video/mp4`) in a floating window, and a missing file gives a clear error; playback is video-only because the guest has no audio device.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter. Type `mkdir -p /tmp/vid && ffmpeg -loglevel error -f lavfi -i testsrc=duration=6:size=320x240:rate=15 /tmp/vid/test.mp4 && ls -la /tmp/vid` + Enter → `test.mp4` (a few tens of KB).
  * Type `xdg-mime query default video/mp4` + Enter → `mpv.desktop`.
  * Press Super+Shift+Alt+F (Files in `/tmp/vid`), double-click `test.mp4`. mpv must open a floating window playing the colour test pattern with a moving counter; it closes by itself at the end or with `q`.
  * From the terminal type `mpv --no-audio /tmp/vid/test.mp4` + Enter: the same clip plays; press `q`.
  * Type `mpv /tmp/vid/missing.mp4` + Enter → `Failed to open /tmp/vid/missing.mp4.` / no such file, back to the prompt.
  * Close Files and the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Skipped here: audio output. mpv may log `[ao] Failed to initialize audio driver`; that is expected.
  * `ffmpeg` is present as a dependency of kdenlive/obs/yt-dlp; if it is missing, report it and use any `.mp4` found with `fd -e mp4 /usr/share`.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the mpv window with the test pattern (after double-click), the `mpv.desktop` line, and the missing-file error
  * If unsuccessful
  ** Screenshot of the wrong player / no window and `xdg-mime query default video/mp4`
covers: manual/22-guis.md:9,74-78; applications/mpv.desktop; default/hypr/apps/system.lua:7-9,41-52
merged-from: 11:mpv-double-click-video

### agent-hotkey-and-cli-with-no-default   [VM-OK]
description: On a fresh Omarchy no default agent is chosen: the agent hotkey opens the picker with no ✓ instead of failing silently, the `a` alias and `omarchy agent` explain how to choose one (exit 1), stray arguments and a bogus agent name are rejected, and the bar shows no agents icon.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Shift+Ctrl+A. The Omarchy Menu must open directly on the "Default Agent" list (Antigravity, Claude, Codex, Copilot, Crush, Cursor CLI, Grok, Hermes, Muse Code, omp, OpenClaw, OpenCode, Ori, Pi) with **no** row carrying a ✓. Press Escape without choosing.
  ** Do not select an agent: it installs through mise (network, minutes).
  * Press Super+Enter. Type `echo "agent=[$(omarchy-default-agent)]"; omarchy default agent` + Enter → `agent=[]` and an empty line (the prompt returns).
  * Type `omarchy agent; echo rc=$?` + Enter → `Choose default agent with: omarchy default agent <name>` and `rc=1`. Type `a; echo rc=$?` + Enter → the same message and a non-zero rc (the `a` alias is `omarchy-agent --inline`); nothing downloads.
  * Type `omarchy agent prompt` + Enter → a usage line for `omarchy agent prompt [--inline] <prompt...>` (from the router or the script — either is fine; it must not try to launch anything).
  * Type `omarchy agent hello` + Enter → `Unexpected argument: hello` and the hint `To pass a prompt: omarchy agent prompt "hello"`.
  * Type `omarchy default agent bogus; echo rc=$?; echo "agent=[$(omarchy-default-agent)]"` + Enter → `Usage: omarchy-default-agent <pi|omp|opencode|ori|claude|codex|grok|openclaw|agy|hermes|copilot|crush|cursor-agent|muse>`, a non-zero rc, and `agent=[]` (the default is still empty).
  * Look at the right section of the top bar: there must be no agents (robot) icon at all on this fresh machine (the panel only appears once usage records exist). Screenshot the bar. Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If a "Set your default agent" notification is still on screen from first boot, that is expected; dismiss it with Super+comma.
  * The exact hint wording is HEAD's; on the 4.0.2 disk record `omarchy-version` and the text you see.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the Default Agent menu with no ✓, the terminal with each message and rc, and the top bar without an agents icon
  * If unsuccessful
  ** Screenshot of what the hotkey did instead, an install starting, or an unset default launching something; `cat ~/.config/omarchy/defaults/agent` (should not exist)
covers: manual/17-ai.md:24-35,38; default/hypr/bindings/utilities.lua:97; bin/omarchy-agent; bin/omarchy-agent-prompt; bin/omarchy-default-agent; default/bash/aliases:46 (a); install/user/first-run/setup-agent.hook; test/shell.d/default-agent-test.sh; test/shell.d/agent-invitation-test.sh
merged-from: 11:agent-hotkey-opens-picker-when-unset; 41:shell-agent-alias-without-default; 61:agent-launch-without-default; 51:agent-launcher-refuses-without-default; 22:agent-cli-without-default-explains

### agent-usage-collectors-without-accounts   [VM-OK]
description: The usage collectors behind the agents panel produce valid records even with no account signed in, and the updater reports a failing collector instead of hiding it; `--except` and a named collector both exit 0.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy agent usage update; echo status=$?` — it may exit non-zero because a collector whose CLI is absent (codex) fails; the failure is printed, not hidden. Record the status.
  * Type `ls ~/.local/state/omarchy/agents/usage/` — `claude.json` and `fireworks.json` are listed.
  * Type `jq -r '.id + " / " + .usageStatusText' ~/.local/state/omarchy/agents/usage/claude.json` — `claude / Waiting for auth`.
  * Type `jq -c '{id,ready,hasPromptStats}' ~/.local/state/omarchy/agents/usage/fireworks.json` — `{"id":"fireworks","ready":false,"hasPromptStats":false}`.
  * Type `omarchy agent usage update --except codex; echo status=$?` — `status=0`.
  * Type `omarchy agent usage update claude; echo status=$?` — `status=0` (only the named collector runs). Look at the bar: still no agents icon. Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If `codex.json` exists, `jq -c '{id,limits}'` on it reads `{"id":"codex","limits":[]}`.
  * The `agent usage` subcommands are HEAD's shape; on 4.0.2 record `omarchy-version` and report "absent on this build" if the router does not know them.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** `claude / Waiting for auth`; the fireworks record; `status=0` for `--except codex` and for `claude` alone
  * If unsuccessful
  ** A `jq` parse error (invalid record) or a missing file
covers: test/shell.d/agent-usage-update-test.sh, agent-usage-claude-scanner-test.sh (id/Waiting for auth), agent-usage-claude-limits-test.sh (no-token status), agent-usage-fireworks-scanner-test.sh (no-credential record), agent-usage-codex-scanner-test.sh (id/limits); bin/omarchy-agent-usage-*
merged-from: 51:agent-usage-collectors-without-accounts

### agent-skills-linked-into-harnesses   [VM-OK]
description: Provisioning links both shipped skills (`omarchy`, `diagnose-crash`) into the skill folders of every supported agent harness, pointing into the read-only package tree, so any agent the user installs later finds them without setup; the package tree itself refuses writes as the skill promises.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and press Super+F for a full screen. Type `for d in ~/.agents/skills ~/.claude/skills ~/.codex/skills ~/.pi/agent/skills ~/.gemini/config/skills ~/.hermes/skills; do echo "== $d"; ls -la "$d" 2>&1; done | sudo tee /dev/ttyS0` + Enter (password `prime`) and read the serial log.
  ** Each directory must exist and hold exactly two symlinks, `omarchy` and `diagnose-crash`, pointing at `/usr/share/omarchy/default/agents/skills/<name>/` (or `$OMARCHY_PATH/…`).
  * Type `ls ~/.hermes/profiles 2>&1` + Enter → "No such file" is fine (profiles are only linked when they exist); report what is there.
  * Type `head -3 ~/.claude/skills/omarchy/SKILL.md` + Enter → the frontmatter starting `name: omarchy` (proves the link resolves); then `ls ~/.codex/skills/omarchy/ ~/.codex/skills/diagnose-crash/` → SKILL.md with capture.md, contributing.md, hooks.md, hyprland.md, plugins.md, theming.md; and SKILL.md with reporting.md.
  * Type `touch /usr/share/omarchy/test-write; echo "exit=$?"` + Enter → Permission denied, `exit=1` (the tree the skill says never to edit is root-owned); then `cat "$OMARCHY_PATH/config/omarchy/shell.json" | head -3` → readable.
  * Type `ls ~/.local/state/omarchy/done/` + Enter → `finalize-user` and `first-run-user`.
  * Press Super+F, then Super+W to close the terminal.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Use get-serial for the six listings; they are longer than one screen.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Serial text with all six directories listing both symlinks to `/usr/share/omarchy/default/agents/skills/`, plus screenshots of the frontmatter, the guide listings, the Permission denied, and the done markers
  * If unsuccessful
  ** The serial text showing the missing directory or dangling link (`ls -l` shows the target; `test -e` it); `ls -la ~ | grep -E '^\.(agents|claude|codex|pi|gemini|hermes)'`
covers: manual/17-ai.md:63-67; docs/file-layout.md:211, §Runtime finalization (skill symlinks, markers); bin/omarchy-provision-user:87-101 (skill linking); bin/omarchy-agent-crash:24; default/agents/skills/omarchy/SKILL.md §Critical Safety Rules, §Topic Guides
merged-from: 61:agent-skills-linked-into-harnesses; 11:omarchy-skill-symlinks-present

### crash-capture-toast-and-mute-one-program   [VM-OK]
description: Once a default agent is named, a real crash produces a `Process crashed: <program>` toast; `omarchy crash mute <name|path>` silences only that program while others still announce and the watcher keeps running; `off` brings it back; a bad name or action is refused.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy-default-agent` + Enter. If it prints nothing, type `mkdir -p ~/.config/omarchy/defaults && echo claude > ~/.config/omarchy/defaults/agent` + Enter (crash toasts are silent on a stock disk until a default agent is named). Type `systemctl --user is-active omarchy-crash-watch.service; omarchy crash mute` → `active` and `No programs muted. Crashes all notify.`
  * Type `sleep 300 & sleep 1; kill -SEGV $!` + Enter → within 5 seconds a toast `Process crashed: sleep` appears; screenshot.
  ** The toast may offer a "diagnose" action; do not click it.
  * Type `omarchy crash mute /usr/bin/sleep` → `Muted crash notifications for sleep.` (a path reduces to its basename); `omarchy crash mute` → lists `sleep`.
  * Repeat the crash command and watch 15 seconds — no toast.
  * Type `cp /usr/bin/sleep /tmp/othersleep; /tmp/othersleep 60 & sleep 0.5; kill -SEGV $!` → a toast `Process crashed: othersleep` appears (other programs still announce; the watcher survived the muted crash).
  * Type `omarchy crash mute sleep off` → `Crash notifications for sleep are back on.` Wait until 60 seconds have passed since the previous `sleep` crash (screenshot every 5 seconds), then crash `sleep` again → the `Process crashed: sleep` toast returns.
  * Unhappy path: type `omarchy crash mute /; echo "exit=$?"` → `Not a program name: /`, `exit=1`; `omarchy crash mute sleep sideways; echo "exit=$?"` → `Not an action: sideways` followed by the usage line, `exit=1`.
  * Round trip: `omarchy crash mute` → `No programs muted. Crashes all notify.`; `rm /tmp/othersleep`; if you created the agent default file, `rm ~/.config/omarchy/defaults/agent`; press Super+Shift+comma to clear toasts; close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The watcher de-duplicates per program per minute, so the "toast returns" crash must be ≥60 s after the previous crash of `sleep`; bridge the wait with screenshots, never one long sleep.
  * If no toast ever appears, `coredumpctl list | tail -3` must list the crash; if it does not, report the environment.
  * `omarchy crash mute` may be missing on a pristine 4.0.2 disk (only "crash capture" is documented); check `omarchy-version` and report "absent on this build", not "broken".
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the toast for `sleep`, the mute confirmation and the list showing `sleep`, silence while muted, the toast for `othersleep`, the toast for `sleep` again after `off`, both errors with `exit=1`, and `active` with the empty list at the end
  * If unsuccessful
  ** No toast at all with the `coredumpctl` listing, a toast while muted, none after unmuting, or the service inactive; `journalctl --user -u omarchy-crash-watch -b | tail | sudo tee /dev/ttyS0`, `ls -la ~/.local/state/omarchy/toggles/crash-ignore/`, and `omarchy-version`
covers: test/shell.d/crash-capture-test.sh (watcher announces, per-program mute, other programs, un-mute, watcher survives); bin/omarchy-crash-watch (crash-ignore flags); bin/omarchy-crash-mute; default/agents/skills/diagnose-crash/SKILL.md §Offer to stop the notifications; manual/17-ai.md
merged-from: 51:crash-mute-silences-one-program; 13:crash-mute-per-program; 24:crash-mute-silences-and-unmutes; 61:crash-mute-one-program

### crash-mute-cli-list-toggle-and-refusals   [VM-OK]
description: `omarchy crash mute` lists, sets, clears and toggles per-program mutes by name or path (paths reduce to their basename, `--` allows a flag-shaped name) and refuses `.`/`..`/`/`, unknown actions and names that climb out of its directory, never reporting a mute it did not write.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter. Type `omarchy crash mute` + Enter → `No programs muted. Crashes all notify.`
  * Type `omarchy crash mute sleep` → `Muted crash notifications for sleep.`; `omarchy crash mute /usr/lib/chromium/chromium-browser` → `Muted crash notifications for chromium-browser.`; `omarchy crash mute` → two lines: `chromium-browser` and `sleep`.
  * Type `omarchy crash mute sleep off` → `Crash notifications for sleep are back on.`; `omarchy crash mute chromium-browser toggle` → `Crash notifications for chromium-browser are back on.`; `omarchy crash mute` → `No programs muted. Crashes all notify.`
  * Type `omarchy crash mute hyprland sideways; echo s=$?` → `Not an action: sideways` followed by the usage line, non-zero.
  * Type `omarchy crash mute . ; echo s=$?; omarchy crash mute .. ; echo s=$?; omarchy crash mute / ; echo s=$?` → three non-zero statuses (`Not a program name: /` for the last).
  * Type `omarchy crash mute ../bar-off; ls ~/.local/state/omarchy/toggles/bar-off; echo exists=$?` → the mute is refused and `ls` fails (nothing written outside `crash-ignore/`).
  * Type `omarchy crash mute -- -h && ls ~/.local/state/omarchy/toggles/crash-ignore/-h` → the `-h` flag file exists; then `omarchy crash mute -- -h off; omarchy crash mute` → back to `No programs muted. Crashes all notify.` Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * All output is plain text in the terminal; no notifications are involved. Keep the space in `mute . ;` so the shell does not read `.;` as one word.
  * `omarchy crash mute` may be missing on a pristine 4.0.2 disk; check `omarchy-version` and report "absent on this build", not "broken".
  </Hints>
  </Instructions>
proof: |
  * on success
  ** One screenshot per command showing the exact message and status; `bar-off` never created; the list empty at the end
  * If unsuccessful
  ** A refusal with status 0, `toggles/bar-off` existing, or a deviating message; `ls -la ~/.local/state/omarchy/toggles/crash-ignore/` and `omarchy-version`
covers: manual/17-ai.md:49; bin/omarchy-crash-mute; bin/omarchy-toggle; bin/omarchy (crash group); test/shell.d/crash-capture-test.sh (omarchy-crash-mute CLI: list, basename, actions, refusals, `--`, toggle)
merged-from: 11:crash-mute-cli; 51:crash-mute-rejects-bad-input

### chromium-bundled-extensions-and-copy-url   [VM-OK] [NET]
description: Chromium starts with Omarchy's flags and the three bundled extensions (Copy URL, Download Video, WhatsApp Slim) with per-user native-messaging hosts registered under pinned ids; Alt+Shift+L (or the Copy URL toolbar button) copies the current tab's full URL with a toast and lands it in the clipboard history, in a normal window and inside a web app.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter and type `wl-copy sentinel; jq -c '{name,path,allowed_origins}' ~/.config/chromium/NativeMessagingHosts/com.omarchy.copy_url.json ~/.config/chromium/NativeMessagingHosts/com.omarchy.ytdlp.json; ls ~/.config/BraveSoftware/Brave-Origin/NativeMessagingHosts/` + Enter → `com.omarchy.copy_url` with a path ending `/omarchy-chromium-copy-url-host` and origin `chrome-extension://bgpiichlckmfanooecilcjemknkcpngb/`; `com.omarchy.ytdlp` with origin `chrome-extension://dedjgknigfeelejglamclffonmophnfl/`; both manifests listed for Brave Origin.
  * Press Super+Shift+Enter; the browser opens with a dark UI. Type `chrome://extensions` in the address bar, Enter → three enabled cards: **Copy URL** 1.5, **Download Video** 1.0, **WhatsApp Slim** 1.1, each described as installed by Omarchy. Type `chrome://version`, Enter → Command Line contains `--ozone-platform=wayland`, `--password-store=gnome-libsecret` and `--load-extension=/usr/share/omarchy/default/chromium/extensions/copy-url,…yt-dlp,…whatsapp-slim`. Type `chrome://extensions/shortcuts`, Enter → Copy URL `Alt+Shift+L`, Download Video `Alt+Shift+D` (record if blank on 4.0.2).
  * Type `https://omarchy.org/manual/?q=one&x=two` in the address bar, Enter; wait for the page. Click into the page area, then press Alt+Shift+L → a toast "URL copied to clipboard" appears top-right within ~2 s.
  * Click the terminal and type `wl-paste` Enter → exactly `https://omarchy.org/manual/?q=one&x=two`. Press Super+Ctrl+V: the clipboard manager lists that URL as the newest entry. Press Escape.
  * Back in Chromium click the puzzle-piece toolbar button, then **Copy URL** → the same toast. Then in the terminal type `wl-copy sentinel` Enter; in Chromium press Ctrl+T (new tab) then Alt+Shift+L; `wl-paste` → either `chrome://newtab/` or still `sentinel`; record which. Nothing may crash.
  * Press Super+Shift+Y (YouTube web app). In the frameless app window press Alt+Shift+L → a toast; `wl-paste` + Enter in the terminal now prints a `https://www.youtube.com/…` URL.
  * Close the browser windows with Super+W and the terminal with Ctrl+D; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Dismiss any "unpacked extensions" bubble on start. Chromium on 2 vCPU may raise Hyprland's "not responding" dialog — click **Wait**.
  * Toasts fade in a few seconds; screenshot immediately after the shortcut. The extension needs a moment after Chromium starts; if the first Alt+Shift+L shows no toast, wait 2 s and press it again.
  * If the shortcut does nothing but the toolbar button works, the shortcut is unregistered on 4.0.2; report as such. If YouTube shows a consent/bot page, the URL copied is still a youtube.com URL — that is enough.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of both host manifests with pinned ids and the Brave Origin copies, the extensions page with three enabled cards, the command line, the shortcuts page, the toast right after Alt+Shift+L, `wl-paste` showing the exact URL with query string, the clipboard-manager entry, the toolbar variant, and the YouTube web-app copy
  * If unsuccessful
  ** Screenshot with no toast and `wl-paste` still `sentinel`, a missing/disabled extension, or missing host files; `ls ~/.config/chromium/NativeMessagingHosts/`
covers: manual/23-browsers.md:19-27; manual/25-web-apps.md:13; default/chromium/extensions/copy-url/*; default/chromium/extensions/*/manifest.json; default/chromium/native-messaging-hosts/*; config/chromium-flags.conf; config/chromium/Default/Preferences; install/user/chromium.sh; bin/omarchy-install-chromium-copy-url; bin/omarchy-install-chromium-ytdlp; bin/omarchy-chromium-copy-url-host; test/shell.d/chromium-copy-url-test.sh; test/shell.d/chromium-ytdlp-test.sh (installer/manifest)
merged-from: 41:chromium-copy-url-extension; 11:copy-url-extension; 51:chromium-copy-url-shortcut-and-hosts; 41:chromium-bundled-extensions-listed

### chromium-download-video-ytdlp   [VM-OK] [NET] [SLOW]
description: Alt+Shift+D hands the current video page to yt-dlp, which notifies on start, shows progress on the OSD and notifies on completion, saving the file under `~/Videos`; a page without a video reports failure instead of staying silent.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter and type `ls ~/Videos` Enter (note the contents, likely nothing).
  * Press Super+Shift+Enter and open `https://www.youtube.com/watch?v=aqz-KE-bpKQ` (a short trailer). Dismiss any consent dialog.
  ** If YouTube shows a sign-in/bot wall from this IP, use `https://vimeo.com/76979871` or `https://commons.wikimedia.org/wiki/File:Big_Buck_Bunny_first_23_seconds_1080p.ogv` and note it.
  * Press Alt+Shift+D → a toast about the download starting; within a few seconds an OSD (the same overlay used for volume) shows the download progress updating in place; later (30 s–3 min) a toast that it finished, naming the title.
  * In the terminal type `ls -la ~/Videos` Enter every ~10 s until a new video file appears and stops growing.
  * Click the completion toast if still visible → mpv plays the file; press `q`.
  * In Chromium open `https://example.com` and press Alt+Shift+D → a notification/OSD saying no video was found or a yt-dlp error — not silence forever, not a crash; report the exact text. `ls ~/Videos` shows no new file.
  * Type `rm ~/Videos/<the downloaded file>` Enter to restore the folder. Press Super+W and Ctrl+D; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Keep the total wait under ~5 minutes; report partial progress otherwise. Screenshot the OSD every ≤5 s. Move the mouse every ~60 s while waiting so the 150 s screensaver does not engage (screenshots are not activity).
  * If the download is refused by the network, screenshot the error OSD and report; the wiring is still demonstrated by the error path.
  * Chromium on 2 vCPU may raise Hyprland's "not responding" dialog — click **Wait**.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the start toast, the OSD progress, the completion toast, the listing with the new file, mpv playing it, and the failure toast for example.com
  * If unsuccessful
  ** Screenshot of no toast after the shortcut and an unchanged `~/Videos`; `journalctl --user -n 40 | grep -i ytdlp | sudo tee /dev/ttyS0` read via get-serial
covers: manual/23-browsers.md:23-25; default/chromium/extensions/yt-dlp/*; default/chromium/native-messaging-hosts/com.omarchy.ytdlp.json; bin/omarchy-chromium-ytdlp-host; test/shell.d/chromium-ytdlp-test.sh
merged-from: 41:chromium-ytdlp-extension; 11:download-video-extension

### browser-policy-colour-helper-rejects-bad-input   [VM-OK]
description: The privileged browser-colour writer behind the root-owned policy directory accepts exactly one argument of six lowercase hex digits and refuses everything else before elevating, so the passwordless sudoers grant can carry nothing but a colour.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal and type `cp /etc/chromium/policies/managed/color.json /tmp/color.before`.
  * Type `for v in 1C2027 abc12 abc1234 1c202g ../../etc/passwd '1c2027 1c2027' '$(id)' '1c2027;id' '#1c2027'; do omarchy-theme-set-browser-policy "$v"; echo "s=$?"; done` — nine non-zero statuses, no sudo/polkit prompt.
  * Type `omarchy-theme-set-browser-policy; echo s=$?; omarchy-theme-set-browser-policy 1c2027 ffffff; echo s=$?` — both non-zero (no argument; two arguments).
  * Type `cmp /tmp/color.before /etc/chromium/policies/managed/color.json && echo unchanged` — `unchanged`.
  * Type `omarchy-theme-set-browser-policy 1c2027; echo s=$?; cat /etc/chromium/policies/managed/color.json` — `s=0`, no prompt, `"BrowserThemeColor": "#1c2027"`.
  * Type `omarchy-theme-set-browser; rm /tmp/color.before` — the theme's own colour is back. Close the terminal with Super+W.
  ** Keep the single quotes around the values containing `$`, `;`, `#` or a space.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * A polkit dialog appearing at any point means the grant was not taken; report it (the `omarchy-theme-browser` sudoers rule is one of the four shipped NOPASSWD drop-ins).
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Eleven non-zero refusals and `unchanged`; the valid colour written passwordlessly; the theme colour restored
  * If unsuccessful
  ** A refusal exiting 0 or modifying `color.json`, or a prompt for the valid colour
covers: test/shell.d/browser-policy-sudoers-test.sh (argument validation, PACKAGED_PATH elevation); bin/omarchy-theme-set-browser-policy; etc/sudoers.d/omarchy-theme-browser
merged-from: 51:browser-policy-helper-rejects-bad-input

### cups-admin-forbidden-and-browsed-absent   [VM-OK]
description: CUPS is enabled, running and serving its web UI on localhost:631, but the desktop user cannot administer printers there or from the CLI (`Forbidden`; Print Settings goes through polkit), and the removed cups-browsed discovery daemon and CUPS-PDF backend are absent with no files left behind.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter and type `systemctl is-enabled cups.service; systemctl is-active cups.service; timeout 10 lpstat -r` Enter → `enabled`, `active`, `scheduler is running`.
  * Type `stat -c '%U:%G %a' /etc/cups/cups-files.conf; head -1 /etc/cups/cups-files.conf; LC_ALL=C timeout 10 lpinfo -v </dev/null; echo rc=$?` Enter → `root:cups 640`, `Permission denied`, a line containing `lpinfo: Forbidden` and a non-zero rc.
  ** Do not use sudo here; the unprivileged result is the point.
  * Press Super+Shift+Enter, type `localhost:631` in the address bar, Enter → the CUPS home page (tabs Home / Administration / Classes / Help / Jobs / Printers).
  * Click **Administration**, then **Add Printer** → a basic-auth dialog; enter `prime` / `prime`. Result: a "Forbidden" page (or the dialog re-appears). The printer wizard must NOT open. Press Escape if re-prompted. Click **Printers** → an empty list loads without authentication. Close Chromium (Super+W).
  * Press Super+Alt+Space, type `Print Settings`, Enter → the printers window opens with an empty list. Click **Add** → a polkit dialog appears (the desktop user is not a CUPS admin); press Escape once to prove it, then click **Add** again and enter `prime`. After the ~10 s scan only generic entries remain; expand `Network Printer` and confirm `Internet Printing Protocol (ipp)` is offered. Cancel and close the window (Super+W).
  ** Skipped here: adding a real printer (none attached; discovery finds nothing in this VM).
  * Open Chromium with Super+Shift+Enter, press Ctrl+P: Destination is `Save as PDF`. Click Save, accept the default name in `~/Downloads`. In the terminal type `ls -la ~/Downloads/*.pdf` → the new PDF with non-zero size; type `rm ~/Downloads/*.pdf` and close Chromium (Super+W).
  * In the terminal type `systemctl is-active avahi-daemon; pacman -Q cups cups-filters system-config-printer cups-pk-helper; pacman -Q cups-browsed cups-pdf 2>&1` Enter → `active`, four package lines, then both `was not found`. Type `systemctl is-enabled cups-browsed.service 2>&1; systemctl is-active cups-browsed.service; pgrep -x cups-browsed; echo pgrep-rc=$?` → `not-found` or `disabled`, `inactive`, no pid, `pgrep-rc=1`.
  * Type `for p in /etc/cups/cups-browsed.conf /etc/cups/cups-browsed.conf.pacsave /etc/cups/cups-browsed.conf.pacnew /usr/bin/cups-browsed /usr/lib/cups/backend/implicitclass /usr/lib/systemd/system/cups-browsed.service /etc/systemd/system/multi-user.target.wants/cups-browsed.service; do [ -e "$p" ] || [ -L "$p" ] && echo "EXISTS $p"; done; echo PATHS-DONE` Enter → no `EXISTS` line before `PATHS-DONE`. Close the terminal (Ctrl+D); the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Chromium marks http://localhost as "not secure"; that is expected. The path loop wraps onto two terminal lines; type it carefully. The Add dialog scans for ~10 s; screenshot when the spinner stops.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of `enabled`/`active`/`scheduler is running`, `root:cups 640` and Permission denied on the policy file, `lpinfo: Forbidden` with non-zero rc, the CUPS home page, the auth dialog and the Forbidden result, the Printers page, the polkit dialog from Print Settings and the Add dialog with the IPP option after authenticating, the Save-as-PDF dialog and the resulting file, avahi active, the package lines with two `was not found`, cups-browsed inactive with `pgrep-rc=1`, and `PATHS-DONE` with no EXISTS lines
  * If unsuccessful
  ** Screenshot of the Add Printer wizard opening for `prime` on the web UI, `lpinfo -v` listing devices, a different owner/mode, the web UI not loading, Print Settings missing or its Add dialog erroring, no PDF written, any EXISTS line, or cups-browsed active
covers: etc/cups/cups-files.conf; etc/cups/cups-browsed.conf; etc/systemd/system/cups-browsed.service.d/10-omarchy.conf; install/config/enable-services.sh (cups, avahi); test/acceptance.d/cups-test.sh:7-51; test/shell.d/cups-hardening-test.sh; manual/46:47-53
merged-from: 41:cups-web-ui-admin-denied; 50:cups-running-denies-unauthenticated-admin; 50:cups-browsed-and-cups-pdf-absent; 13:faq-print-settings-and-pdf-printing

### docker-requires-sudo-polkit-tui-and-predicate   [VM-OK]
description: The install user is deliberately not in the docker group, so plain `docker` (and the `d` alias) is refused while `sudo docker` works and the Docker TUI hotkey prompts polkit; the hidden `omarchy sudo docker` predicate says "needs sudo" now and as configured and decides which Sudoless Docker row the Security menus show; `omarchy sudo keepalive` only asks for the password.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter. Type `command -v docker; id -nG; ls -l /var/run/docker.sock` + Enter: the docker path prints, the group list includes `wheel` but not `docker`, and the socket is `srw-rw---- root docker`.
  * Type `docker ps; echo rc=$?` + Enter → `permission denied while trying to connect to the docker API at unix:///var/run/docker.sock` (or `… the Docker daemon socket`; wording may vary — it must be a permission error, not a hang), `rc=1`. Type `d ps` + Enter → the same error (the alias is refused the same way). Type `timeout 10 docker info 2>&1 | head -3; echo rc=${PIPESTATUS[0]}` → a permission-denied or cannot-connect error and a non-zero rc.
  * Type `sudo docker ps` + Enter, password `prime` → after a few seconds a `CONTAINER ID   IMAGE …` header with no rows. Type `sudo docker compose version` → `Docker Compose version v2.x`; `sudo docker info 2>&1 | head -3` → client/server info.
  ** `docker.socket` is socket-activated; the first `sudo docker` can take ~10 s while `docker.service` starts — keep screenshotting.
  * Type `omarchy sudo docker; echo "exit=$?"; omarchy sudo docker --configured; echo "exit=$?"` → `exit=0` twice (needs sudo now and as configured). Type `omarchy sudo docker --bogus; echo "exit=$?"` → `Usage: omarchy-sudo-docker [--configured]`, `exit=2`.
  * Press Super+Space → Setup → Security: a `Sudoless Docker` row is present. Escape. Then Remove → Security: NO `Sudoless Docker` row. Escape.
  * Press Super+Shift+D (Docker TUI): a polkit password dialog appears (the user is not in the docker group). Press Escape and report what the window shows; it must not reach a running Docker TUI as root without a password.
  * Type `omarchy sudo keepalive; echo "exit=$?"` + Enter, enter `prime` → the prompt returns at once with `exit=0`. Type `pgrep -fc 'sudo -n true'` → `0` (the keepalive loop dies with the script; it only works when sourced). Type `sudo -k`; close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The Security submenus are under Setup and Remove in the root Omarchy menu (Super+Space).
  * A polkit dialog appears centre-screen; Escape cancels it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the groups line without `docker` and the socket permissions, the permission errors for `docker ps` (`rc=1`), `d ps` and `docker info` with a non-zero rc, the empty container table, the compose version and server info, the three predicate exit codes, the two Security submenus, the polkit dialog after Super+Shift+D, and the keepalive returning with `0` leftover loops
  * If unsuccessful
  ** Screenshot of unelevated `docker ps`/`docker info` succeeding, the user in the docker group, the daemon failing under sudo, `Sudoless Docker` in both menus or neither, `--bogus` accepted, or the TUI running without a prompt; `systemctl status docker.socket docker.service | head -20 | sudo tee /dev/ttyS0` read via get-serial
covers: manual/18-development-tools.md:23-27; install/config/docker.sh; etc/docker/daemon.json; etc/systemd/system/docker.service.d/no-block-boot.conf; bin/omarchy-sudo-docker; bin/omarchy-sudo-keepalive; default/bash/aliases:50 (d); default/omarchy/omarchy-menu.jsonc:186,302; test/shell.d/sudo-docker-test.sh; test/shell.d/sudoless-docker-posture-test.sh; test/acceptance.d/system-test.sh:86-100
merged-from: 11:docker-requires-sudo-by-default; 50:docker-unreachable-without-elevation; 20:sudo-docker-and-keepalive; 41:docker-cli-requires-elevation

### sudoless-docker-enable-and-revert   [VM-OK]
description: Setup → Security → Sudoless Docker is off by default, warns that the docker group is root-equivalent, does nothing when declined, adds the user to `docker` and records a reboot requirement when accepted (hiding its row and surfacing the Remove row), refuses to enable twice, and Remove → Security → Sudoless Docker undoes it.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `id -nG | tr ' ' '\n' | grep -c '^docker$'; omarchy-sudo-docker --configured; echo $?` → `0` and `0` (not configured).
  * Open Omarchy Menu (Super+Space) → Setup → Security. A "Sudoless Docker" row must be present (also Fido2, SSHD, Passwordless Sudo; no Fingerprint on this machine). Select Sudoless Docker.
  ** A floating "Omarchy" terminal shows the `⚠️  WARNING` text about `docker run -v /:/host alpine` and asks `Enable sudoless Docker? This gives anything running as you passwordless root.` Choose **No** (press `n`) → `Aborted. No changes made. Docker access still goes through a prompt.` then Done!; press a key. `getent group docker; ls ~/.local/state/omarchy/reboot-required` → no `prime`, `No such file`. Remove → Security: Sudoless Docker is NOT listed while off; in the terminal `omarchy-remove-security-sudoless-docker` → a no-op message, no reboot prompt.
  * Repeat Setup → Security → Sudoless Docker, this time choose **Yes**; enter the sudo password `prime` → `Sudoless Docker ENABLED. It takes effect after a reboot.` and `Reboot now to apply?` — choose **No**. Press a key at Done!.
  * In the terminal: `getent group docker` → the line ends with `prime`; `id -nG prime | tr ' ' '\n' | grep -c '^docker$'` → `1`; `omarchy-sudo-docker --configured; echo $?` → `1` (configured to not need sudo); `omarchy-sudo-docker; echo $?` → `0` (still needs it this session — no docker socket access until a reboot); `ls ~/.local/state/omarchy/reboot-required; omarchy-state get reboot-required 2>/dev/null` → the reboot-required flag is present (the bar may show a reboot indicator; report what you see).
  * Open Omarchy Menu → Setup → Security (reopen twice): Sudoless Docker is gone; Remove → Security now lists Sudoless Docker. In the terminal type `omarchy-setup-security-sudoless-docker` → `Sudoless Docker is already enabled: prime is in the docker group.` and the hint to run the remove command.
  * Remove → Security → Sudoless Docker → confirm, sudo password if asked → `Removing prime from the docker group...`, `Sudoless Docker DISABLED …`, `Reboot now to apply?` → **No**. Done!, press a key.
  * `getent group docker` → no longer lists `prime`; `omarchy-sudo-docker --configured; echo $?` → `0`. Setup → Security shows Sudoless Docker again. Type `omarchy-state clear reboot-required` to drop the flag. Close the terminal with Super+W.
  ** Skipped: the reboot itself, which would actually grant the group to the session.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Never answer Yes to the reboot. gum confirm: Left/Right or Tab to move, Enter to pick (`n`/`y` also work); the highlighted button is the selection.
  * `id -nG` without a user shows the running session's groups (still without docker until reboot); `id -nG prime` shows the configured ones. If usermod reports the docker group does not exist, report it and stop.
  * Menu guards paint from the previous open — reopen a submenu twice before asserting a row moved. A "reboot required" hint may linger in later `omarchy update` runs on this disk if the flag is not cleared; end the session with `stop` if the disk should not be kept.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the warning text, the Aborted line with no group/flag change and the Remove row absent plus the no-op remover, the ENABLED line with the declined reboot question, `getent group docker` with `prime`, the two exit codes, the reboot-required flag, the menu without the Setup row and with the Remove row, the already-enabled message, the DISABLED message, and the restored state with the flag cleared
  * If unsuccessful
  ** Screenshot of the failing step, the floating terminal's error text (e.g. usermod failure), the group added after No, both menu rows shown together, a reboot happening despite No, `getent group docker` and `omarchy-state get reboot-required`
covers: manual/18-development-tools.md:25; default/omarchy/omarchy-menu.jsonc:186,302 (setup.security.sudoless-docker, remove.security.sudoless-docker); bin/omarchy-setup-security-sudoless-docker; bin/omarchy-remove-security-sudoless-docker; bin/omarchy-sudo-docker; bin/omarchy-state; install/config/docker.sh; test/shell.d/sudoless-docker-toggle-test.sh; test/shell.d/provisioning-groups-test.sh; test/shell.d/sudo-docker-test.sh; test/shell.d/sudoless-docker-posture-test.sh
merged-from: 11:sudoless-docker-opt-in-and-revert; 25:sudoless-docker-enable-and-disable; 42:setup-sudoless-docker-toggle; 24:sudoless-docker-enable-and-menu-moves; 41:sudoless-docker-menu-decline; 52:sudoless-docker-toggle-flags-reboot

### firewall-ufw-defaults-no-ssh   [VM-OK] [NET]
description: Out of the box UFW is active with deny-in/allow-out, only the LocalSend (53317) and Docker-DNS exceptions and no SSH rule; sshd is disabled, the user is not in the docker group, `ufw` itself needs root, and outbound web traffic works — the stock posture the manual promises.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter and type `systemctl is-active ufw; ufw status; echo rc=$?` Enter → `active`, then `ERROR: You need to be root to run this script`, `rc=1`.
  * Type `sudo ufw status verbose | sudo tee /dev/ttyS0` Enter (password `prime`) and read it with get-serial.
  ** `Status: active`; `Default: deny (incoming), allow (outgoing)…`; rules for `53317/udp` and `53317/tcp` ALLOW IN Anywhere; `172.17.0.1 53/udp` ALLOW IN from `172.16.0.0/12` and `192.168.0.0/16` (two `allow-docker-dns` rules); NO `22/tcp` rule.
  * Type `systemctl is-enabled sshd; systemctl is-active sshd; sudo grep -c DOCKER-USER /etc/ufw/after.rules` Enter → `disabled` (or not-found), `inactive`, a number greater than 0 (ufw-docker installed).
  * Type `id; docker ps` Enter → the groups list has no `docker`; a permission-denied error, not a container list.
  * Open the Omarchy Menu (Super+Space) → Setup → Security: rows include SSHD, Fido2, Passwordless Sudo, Sudoless Docker (no Fingerprint); Remove → Security must NOT show SSHD (not enabled). Escape. Do not enable SSHD in this test.
  * Type `curl -s --max-time 5 -o /dev/null -w '%{http_code}\n' https://omarchy.org` Enter → `200`. Press Ctrl+D; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * ufw's table is wide; the serial copy is the reliable read. These facts are not visible in any UI; keep the terminal readable.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the non-root refusal; serial text of `ufw status verbose` showing active / deny incoming / 53317 rules / docker-dns rules / no port 22; screenshot of sshd disabled and inactive, the DOCKER-USER count, `id` without docker and `docker ps` denied, the Security submenus, and the `200`
  * If unsuccessful
  ** `Status: inactive`, a missing default deny, a `22/tcp` rule on a stock disk, sshd active, or docker in the user's groups; `./client get-serial`
covers: manual/35-networking.md (The firewall); manual/48:6; install/config/firewall.sh; install/config/docker.sh; install/config/enable-services.sh; install/omarchy-base.packages (ufw); omarchy-menu.jsonc setup.security.sshd, remove.security.sshd (when); test/shell.d/firewall-config-test.sh; test/acceptance.d/system-test.sh
merged-from: 41:firewall-ufw-defaults; 12:firewall-default-ufw-status; 13:firewall-defaults-deny-incoming-localsend-open

### system-services-enabled-and-running   [VM-OK] [NET]
description: The install enables exactly the shipped system services (NetworkManager, resolved, ufw, sddm, avahi, cups, power-profiles-daemon, docker.socket, oomd, snapper cleanup, limine sync) and leaves sshd, snapper timelines and wait-online off/masked; the daemons are active, names resolve through systemd-resolved with LLMNR and mDNS off and a `.local` miss returning quickly, resolv.conf is the stub, ufw-docker is wired, and nothing listens on port 22.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `systemctl is-enabled cups avahi-daemon docker.socket systemd-resolved NetworkManager power-profiles-daemon sddm systemd-oomd ufw linux-modules-cleanup snapper-cleanup.timer limine-snapper-sync 2>&1` Enter → `enabled` for each (report any `static`/`disabled`/`not-found`).
  * Type `systemctl is-enabled sshd snapper-timeline.timer NetworkManager-wait-online 2>&1` Enter → `disabled`, `disabled`, `masked`.
  * Type `systemctl is-active NetworkManager systemd-resolved ufw docker.socket; readlink /etc/resolv.conf` Enter → all `active`; `../run/systemd/resolve/stub-resolv.conf`.
  * Type `resolvectl status | grep -E 'Protocols|DNS Servers' | head -3; grep '^hosts:' /etc/nsswitch.conf` Enter → Protocols show `-LLMNR -mDNS`, a DNS server (the NAT gateway, 10.0.2.3), and `hosts: mymachines mdns_minimal [NOTFOUND=return] resolve files myhostname dns`.
  * Type `resolvectl query omarchy.org; getent hosts $(hostname)` Enter → an address for each. Unhappy path: `time getent hosts nonexistent.local; echo rc=$?` → no output, `rc=2`, real time under 1 s (mdns_minimal returns instead of hanging).
  * Type `systemctl --user is-active pipewire.service pipewire-pulse.service wireplumber.service` Enter → `active` three times.
  * Type `sudo iptables -S DOCKER-USER 2>/dev/null | grep -c ufw-docker; grep ENABLED /etc/ufw/ufw.conf` Enter (password `prime`) → ≥1 and `ENABLED=yes`.
  * Unhappy path: type `curl -m 3 telnet://localhost:22; echo "rc=$?"` Enter → connection refused (`rc=7`): no daemon listens on 22.
  * Close the terminal with Super+W. The desktop must look exactly as at the start.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * `systemctl is-enabled` prints one state per line in argument order; output is short, no serial redirection needed.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot showing the enabled/disabled/masked lines, the active states and the resolv.conf link, the `-LLMNR -mDNS` protocol flags and nsswitch line, the two successful lookups and the fast `.local` miss with its time, three user `active`, the ufw-docker count with `ENABLED=yes`, and the refused connection to 22
  * If unsuccessful
  ** Screenshot of the offending line plus `systemctl status <unit>` output, `+mDNS`/`+LLMNR`, a lookup failing, the `.local` query taking seconds, or a daemon answering on 22
covers: test/acceptance.d/system-test.sh:65-84; install/config/enable-services.sh; install/config/firewall.sh; install/config/snapper.sh (timers); install/hardware/network.sh; etc/systemd/resolved.conf.d/*; etc/nsswitch.conf; omarchy-iso configure_dns_resolver, configure_ssh_access (absence)
merged-from: 50:system-services-enabled-and-running; 42:services-enabled-and-firewall-defaults; 41:resolved-and-nsswitch-defaults

### user-units-running-and-hardware-gated-units-inert   [VM-PARTIAL]
description: The shipped user systemd units are in the right state on a VM — sleep-lock, fcitx5 and crash-watch enabled and running, migrate-notify done with nothing pending, hardware-gated units (bt-agent, tailscale-receive, recover-internal-monitor, Cam Link relay, speaker tuning) enabled but inert with a condition note — and nothing has failed; the hardware paths themselves are skipped.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter and type `systemctl --user list-units --all 'omarchy-*' 'bt-agent*' --no-pager` Enter.
  ** `omarchy-sleep-lock`, `omarchy-fcitx5`, `omarchy-crash-watch` active/running; `omarchy-migrate-notify`, `omarchy-recover-internal-monitor`, `bt-agent`, `omarchy-tailscale-receive` inactive/dead (conditions); none `failed`.
  * Type `systemctl --user is-enabled bt-agent omarchy-recover-internal-monitor omarchy-sleep-lock omarchy-migrate-notify omarchy-fcitx5 omarchy-crash-watch` Enter → six lines of `enabled`.
  * Type `systemctl --user --failed --no-pager; omarchy-migrate --pending` Enter → `0 loaded units listed` and nothing pending.
  * Type `systemctl --user status bt-agent omarchy-tailscale-receive --no-pager 2>&1 | grep -E 'Active|Condition'; bluetoothctl show 2>&1 | head -1` Enter → both inactive with a condition note (none `failed`); `No default controller available`.
  * Type `systemctl list-units --all 'v4l2-relayd*' 'camlink*' --no-pager; ls /dev/camlink4k` Enter → no such units loaded (or inactive) and `No such file`.
  * Type `wpctl status | head -12; journalctl -b -p err --no-pager | grep -icE 'wireplumber|pipewire|bt-agent'; systemctl --user is-active pipewire wireplumber` Enter → an audio graph with no real sink (the `auto_null` Dummy Output), `0` errors, `active` twice.
  * Unhappy path: type `systemctl --user is-enabled omarchy-no-such-unit; echo $?` Enter → `Failed to get unit file state … No such file or directory` and a non-zero code. Press Ctrl+D; the desktop is as before.
  ** Skipped: the hardware paths themselves (no camera, Bluetooth adapter, XPS speakers, tailscale or real sleep).
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * "inactive (dead)" with a Condition line is the expected shape; only `failed` counts against it. If the table wraps, press Super+F to fullscreen the terminal for the screenshot, then Super+F again. `--no-pager` keeps output on screen; `q` exits a pager if one opens.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the unit table with the expected states, six `enabled`, the empty failed list and no pending migrations, bt-agent/tailscale conditions and the missing controller, no camlink units/device, the clean audio status with `0` errors and two `active`, and the unknown-unit error
  * If unsuccessful
  ** Screenshot of any `failed` unit or a restart loop; `systemctl --user status <unit> --no-pager` for the unit that is disabled or failed
covers: default/systemd/user/*.service; default/systemd/user/{bt-agent,omarchy-tailscale-receive,omarchy-speaker-tuning}.service; install/user/first-run/enable-user-units.sh; bin/omarchy-provision-first-run; docs/file-layout.md (First-run); default/udev/*; default/systemd/system/camlink-4k-loopback.service; default/systemd/system/v4l2-relayd@camlink.service.d/camlink.conf; default/v4l2-relayd/camlink.conf; default/audio/**; default/wireplumber/**; config/wireplumber/**; test/shell.d/systemd-test.sh
merged-from: 41:user-services-status; 42:firstrun-user-units-enabled; 41:hardware-only-units-inert

### fcitx5-supervised-and-hidden-entries   [VM-OK]
description: fcitx5 runs as a supervised user service with no tray icon, comes back within seconds if killed, still composes emoji through the Caps Lock compose key, and its config tools, the print applet and the snapper notifier are hidden from the launcher and autostart.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter and type `pgrep -a fcitx5; cat ~/.config/autostart/*.desktop` Enter.
  ** One process with `--disable notificationitem`; three files each `[Desktop Entry]` / `Hidden=true`.
  * Look at the tray in the top bar: no input-method icon, no printer icon.
  * Type `pkill -x fcitx5; sleep 3; pgrep -a fcitx5` Enter → a new PID (restarted by the service).
  * Type `echo "` then press CapsLock, `m`, `s`, then type `"` and Enter → 😄 still composes (Caps Lock is the Compose key).
  * Press Super+Alt+Space, type `fcitx` → no entries; type `btop` → no entry. Press Escape.
  * Type `pgrep -af 'print-applet|limine-snapper-notify' || echo none` Enter → `none`.
  * Press Ctrl+D; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The restart takes ~2 s; screenshot after the sleep completes. Send Caps Lock as `<CAPSLOCK>`.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the process/autostart output, the tray, the new PID after pkill, a composed emoji, the empty launcher searches, and `none`
  * If unsuccessful
  ** Screenshot of a tray IM icon, fcitx5 not restarting, a literal `ms` instead of the emoji, or launcher entries for fcitx/btop
covers: default/systemd/user/omarchy-fcitx5.service, config/autostart/*.desktop, config/fcitx5/conf/*, default/omarchy/launcher.hides, test/shell.d/systemd-test.sh
merged-from: 41:fcitx5-supervised-and-hidden

### kernel-linux-omarchy-headers-and-tuning   [VM-OK]
description: The guest boots the supported `linux-omarchy` kernel with matching headers (what DKMS modules depend on), and Omarchy's kernel/systemd tuning is in effect at runtime: BBR, kyber on the disk, raised inotify and open-file limits, 5 s stop timeouts, USB autosuspend off and the power key ignored.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `uname -r; cat /usr/lib/modules/$(uname -r)/pkgbase` Enter. The second line must be `linux-omarchy`.
  ** `linux-t2` is for Apple hardware only; report it if it appears.
  * Type `pacman -Q linux-omarchy-headers; cat /usr/lib/modules/$(uname -r)/build/include/config/kernel.release` Enter → the package and version, then exactly the `uname -r` string.
  * Type `sysctl net.ipv4.tcp_congestion_control fs.inotify.max_user_watches; cat /sys/block/vda/queue/scheduler` Enter → `bbr`, `524288`, `[kyber]`.
  * Type `ulimit -Sn; ulimit -Hn; cat /sys/module/usbcore/parameters/autosuspend` Enter → `65536`, `524288`, `-1`.
  * Type `systemctl show -p DefaultTimeoutStopUSec; systemd-analyze cat-config systemd/logind.conf | grep -E '^(HandlePowerKey|InhibitDelayMaxSec)='` Enter → `5s`, `HandlePowerKey=ignore`, `InhibitDelayMaxSec=15`.
  * Close the terminal with Super+W. The desktop must look exactly as at the start.
  ** Skipped: pressing the physical power key (not injectable from the client).
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * All proofs are printed lines; one screenshot per command suffices. Compare the release strings character by character.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots with `linux-omarchy`, the headers package line and identical release strings, and the three tuning outputs matching the values
  * If unsuccessful
  ** Screenshot of the mismatch or "No such file", `cubic`, `[none]`/`[mq-deadline]` on vda, `1024` open files, or `HandlePowerKey=poweroff`
covers: test/acceptance.d/system-test.sh:27-39; etc/sysctl.d/*; etc/udev/rules.d/60-omarchy-io-scheduler.rules; etc/modprobe.d/omarchy-usb-autosuspend.conf; etc/systemd/{system,user}.conf.d/20-omarchy-nofile.conf; etc/systemd/system.conf.d/10-faster-shutdown.conf; etc/systemd/logind.conf.d/*
merged-from: 41:kernel-tuning-and-limits; 50:system-kernel-headers-match

### stock-system-policy-invariants   [VM-OK]
description: A fresh install carries the security and service posture the installer and migrations promise: no privileged groups granted, NetworkManager not networkd, supervised user services, oomd tuned to protect the compositor, Snapper without timelines, Tokyo Night seeded, no legacy tmux alert hooks, no repository-bin PATH injection for mise.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run the following, sending the output to the serial console so it can be read in full: `{ id -nG; pacman -Q ydotool xpadneo-dkms 2>&1; systemctl is-active NetworkManager systemd-networkd 2>&1; systemctl is-enabled systemd-oomd 2>&1; cat /etc/systemd/oomd.conf.d/10-omarchy.conf; cat ~/.config/systemd/user/app.slice.d/10-oomd.conf /usr/lib/systemd/user/app.slice.d/10-oomd.conf 2>/dev/null; systemctl --user is-enabled omarchy-sleep-lock.service omarchy-migrate-notify.service omarchy-fcitx5.service 2>&1; systemctl --user is-active omarchy-sleep-lock.service omarchy-fcitx5.service 2>&1; systemctl --user status bt-agent.service 2>&1 | head -n 5; ls /usr/lib/systemd/user/omarchy-update-user-notify.path 2>&1; cat ~/.local/state/omarchy/current/theme.name; grep -c omarchy-tmux-alert ~/.config/tmux/tmux.conf; ls -d ~/Work/tries ~/Work/.mise.toml 2>&1; grep -E '^(TIMELINE_CREATE|NUMBER_LIMIT)=' /etc/snapper/configs/root 2>&1; grep Hidden ~/.config/autostart/limine-snapper-notify.desktop 2>&1; } 2>&1 | sudo tee /dev/ttyS0` (password `prime`).
  * Read the serial console (`get-serial`) and check:
  ** `id -nG` contains `wheel` and does NOT contain `docker`; it contains `input` only if `pacman -Q ydotool` or `xpadneo-dkms` succeeded.
  ** `NetworkManager` is `active`, `systemd-networkd` is `inactive`.
  ** `systemd-oomd` is `enabled`; the oomd conf has `DefaultMemoryPressureLimit=50%` and `DefaultMemoryPressureDurationSec=20s`; the app.slice drop-in has `ManagedOOMMemoryPressure=kill` and `ManagedOOMSwap=kill`.
  ** `omarchy-sleep-lock.service`, `omarchy-migrate-notify.service`, `omarchy-fcitx5.service` are `enabled`; sleep-lock and fcitx5 are `active`.
  ** `bt-agent.service` shows a skipped `ExecCondition` (no bluetooth) rather than a failure.
  ** `omarchy-update-user-notify.path` does not exist.
  ** `theme.name` is `tokyo-night` (Tokyo Night).
  ** tmux alert hook count is `0`; `~/Work/tries` exists and `~/Work/.mise.toml` does not.
  ** Snapper `TIMELINE_CREATE="no"`, `NUMBER_LIMIT="5"`; the limine notifier autostart has `Hidden=true`.
  * Type `id -nG | tr ' ' '\n' | grep -x input; echo rc=$?; head -c1 /dev/input/event0; echo " rc=$?"` Enter → nothing listed and `rc=1` (the user is not in `input`, which would let any process read raw keystrokes), then `Permission denied` and a non-zero rc for the raw device.
  ** If `input` is listed, membership is acceptable only if `pacman -Q ydotool` or `xpadneo-dkms` above succeeded. If `/dev/input/event0` does not exist, use any `/dev/input/event*` that `ls /dev/input` lists.
  * Close the terminal with Super+W; the machine is unchanged.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Some files may live under `/usr/lib/systemd/user/` instead of `~/.config/systemd/user/`; the command already tries both.
  * `cat ~/.local/state/omarchy/current/theme.name` may print `Tokyo Night` with capitals on older builds; either spelling is fine.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Serial dump (`get-serial`) containing every value above as expected, plus a screenshot of the terminal command and of the `input` grep with `rc=1` and the `Permission denied` on the raw input device
  * If unsuccessful
  ** Serial dump showing `docker` in the groups, `input` in the groups without a justifying package, a readable input device, `systemd-networkd active`, a disabled/inactive Omarchy user unit, a missing oomd setting, `TIMELINE_CREATE="yes"`, or a tmux alert hook
  ** Output of `omarchy-version`
covers: install/config/docker.sh, install/config/browser-policy.sh, bin/omarchy-provision-owner, install/hardware/network.sh, default/systemd/user/*.service, default/systemd/user/app.slice.d/10-oomd.conf, etc/systemd/oomd.conf.d/10-omarchy.conf, install/user/first-run/enable-user-units.sh, install/config/enable-services.sh, install/user/theme.sh, migrations/1785189600.sh, install/user/mise-work.sh, default/snapper/root, config/autostart/limine-snapper-notify.desktop; test/shell.d/provisioning-groups-test.sh, sudoless-docker-posture-test.sh, network-manager-transition-test.sh, systemd-test.sh, user-theme-test.sh, tmux-alert-removal-migration-test.sh, mise-work-path-test.sh, snapper-test.sh, sleep-monitor-test.sh; test/acceptance.d/security-test.sh:17-30,104; manual/48-security.md, manual/47-system-snapshots.md
merged-from: 52:stock-system-policy-invariants; 50:security-user-not-in-input-group

### gpg-keyserver-defaults   [VM-OK] [NET]
description: GnuPG is preconfigured with hkps keyservers and a short connect timeout so a key fetch works out of the box and a bad server fails fast instead of hanging.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter and type `cat ~/.gnupg/dirmngr.conf` Enter.
  ** Five `keyserver hkps://…` lines and `connect-quick-timeout 4`.
  * Type `gpg --recv-keys 4AEE18F83AFDEB23 2>&1 | tail -2` Enter (GitHub's web-flow key) → `imported` or `not changed`.
  * Type `gpg --keyserver hkps://127.0.0.1:1 --recv-keys 4AEE18F83AFDEB23 2>&1 | tail -1` Enter → a connection error within a few seconds.
  * Press Ctrl+D; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The first fetch may take ~10 s through NAT; keep screenshotting every ≤5 s.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the config, the successful import, and the fast failure
  * If unsuccessful
  ** Screenshot of a hang beyond 30 s or a missing config
covers: default/gpg/dirmngr.conf, etc/gnupg/dirmngr.conf
merged-from: 41:gpg-keyserver-defaults

### first-run-artefacts-and-user-state-present   [VM-OK]
description: A minted install carries the artefacts first-run and user finalization create — done markers, a clean first-run log, `$OMARCHY_PATH` and the package version in the desktop and on a text console, theme and background state links, the folded home layout with XDG dirs and GTK bookmarks, Chromium/HEY as browser and mailto handlers, keyring, XCompose, GNOME settings, skill links, the three post-update hooks, a valid shell.json and the About wordmark — and `omarchy-done check` answers for known and unknown markers; a missing one means first login silently failed.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter. Run `ls ~/.local/state/omarchy/done/; echo "$OMARCHY_PATH"; omarchy version; which omarchy-theme-set; ls /etc/omarchy.conf 2>&1` → `finalize-user` and `first-run-user`; `/usr/share/omarchy`; the package version; `/usr/bin/omarchy-theme-set`; `No such file` (not dev-linked). Run `cat ~/.local/state/omarchy/first-run.log` → every step has a `Completed:` line and there is no `Failed:` line.
  * Run `cat ~/.local/state/omarchy/current/theme.name; ls -l ~/.local/state/omarchy/current/theme ~/.local/state/omarchy/current/background` → `Tokyo Night` (or `tokyo-night` on other builds) and two symlinks into the themes tree.
  * Run `ls -d ~/.config/omarchy/themes ~/.config/btop/themes/current.theme ~/.local/share/keyrings/Default_keyring.keyring ~/.XCompose ~/Work/tries ~/.config/omarchy/hooks/post-update.d` → every path exists. Run `ls ~/.config/omarchy/hooks/post-update.d/` → `install-voxtype.hook setup-fingerprint.hook setup-agent.hook`.
  * Run `xdg-settings get default-web-browser; xdg-mime query default x-scheme-handler/mailto; xdg-mime query default x-scheme-handler/https` → `chromium.desktop`, `HEY.desktop`, `chromium.desktop`. Run `xdg-user-dir DESKTOP; xdg-user-dir TEMPLATES; xdg-user-dir PUBLICSHARE; xdg-user-dir DOWNLOAD` → the first three print `/home/prime` (folded into `$HOME`), the last `/home/prime/Downloads`. Run `for d in DESKTOP DOCUMENTS DOWNLOAD PICTURES; do p=$(xdg-user-dir $d); [ -d "$p" ] && echo "OK $d $p" || echo "MISSING $d $p"; done` → four `OK` lines.
  * Run `ls -d ~/Downloads ~/Pictures ~/Videos ~/Work; ls -d ~/Desktop ~/Templates ~/Public 2>&1; cat ~/.config/gtk-3.0/bookmarks` → the first four exist, the last three `No such file or directory`, and four bookmark lines `file:///home/prime/Downloads Downloads`, `…/Projects Projects`, `…/Pictures Pictures`, `…/Videos Videos`. Run `readlink ~/.claude/skills/omarchy ~/.codex/skills/omarchy ~/.agents/skills/omarchy` → each prints `/usr/share/omarchy/default/agents/skills/omarchy`.
  * Run `gsettings get org.gnome.desktop.interface gtk-theme; gsettings get org.gnome.desktop.interface color-scheme; gsettings get org.gnome.desktop.interface icon-theme; gsettings get org.gnome.desktop.interface gtk-enable-primary-paste` → `'Adwaita-dark'`, `'prefer-dark'`, `'Yaru-blue'`, `true`. Run `test -s ~/.config/omarchy/shell.json && jq empty ~/.config/omarchy/shell.json && echo JSON-OK` → `JSON-OK`; then `echo '{bad' | jq empty; echo rc=$?` → a jq parse error and non-zero rc (proves the check is real).
  ** On the 4.0.2 disk `~/.config/omarchy/shell.json` may not exist until first customisation; if absent, report it and run the same check on `/usr/share/omarchy/config/omarchy/shell.json`.
  * Unhappy path: run `git config --global user.name; echo "rc=$?"` → nothing printed and `rc=1` (identity was skipped at install); `grep '<n>' ~/.XCompose` → the binding is present with an empty string `""`; `xdg-mime query default x-scheme-handler/nonsense; echo "rc=$?"` → empty line, `rc=0`; `omarchy-done check first-run-user; echo $?; omarchy-done check no-such-marker; echo $?` → `0` then `1`.
  * Press Super+Shift+F → Nautilus' sidebar shows the Downloads/Projects/Pictures/Videos bookmarks; screenshot, Super+W. Press Super+Space → About → the Omarchy wordmark (from logo.txt) is drawn in a window; Super+W. Press Ctrl+Alt+F3 → a text console; log in `prime` / `prime`; type `echo $OMARCHY_PATH; omarchy version; exit` → the same two values as on the desktop; screenshot, then press Ctrl+Alt+F1 (or F2) to return to the desktop. Close the terminal with Super+W.
  ** Quirk: the serial log does not capture TTY3; the screenshot is the proof. If Ctrl+Alt+F1 shows a text console, the graphical session is on F2.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The terminal is foot; output is small text — keep each command's output short and screenshot after each. ./client-with-image returns the screenshot straight away and saves a round trip.
  * If Super+Shift+F does not open Nautilus on this build, open it from the Omarchy Menu → Apps.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the done markers, `OMARCHY_PATH`, version, binary path and the missing `/etc/omarchy.conf`, first-run.log with only `Starting:`/`Completed:` lines, the theme name and two symlinks, every path present with the three hooks, the browser/mailto/https handlers, the folded user dirs with four `OK`, the folder listing and four bookmark lines, the three skill targets, the gsettings values `'Adwaita-dark' 'prefer-dark' 'Yaru-blue' true`, `JSON-OK` with the jq parse error, the unhappy-path values (`rc=1` git identity, XCompose binding, empty nonsense handler with `rc=0`, `0`/`1` from `omarchy-done check`), Nautilus' sidebar bookmarks, About with the wordmark, and the TTY3 session printing the same `OMARCHY_PATH` and version
  * If unsuccessful
  ** The command output showing the missing path, the `Failed:` line in first-run.log, any MISSING line, a wrong default handler, a leftover `~/Desktop`, jq failing on shell.json, a wrong value, or `tail -40 /var/log/omarchy-install.log`
covers: bin/omarchy-provision-first-run, bin/omarchy-provision-user (xdg-user-dirs, bookmarks, default browser/mailto), install/user/{theme,xcompose,git,default-keyring,mise-work}.sh, install/user/first-run/{gnome-theme,gtk-primary-paste,enable-user-units}.sh, bin/omarchy-done, default/bash/env-bootstrap, logo.txt, icon.txt, docs/file-layout.md (First-run, Runtime finalization, §Env bootstrap), test/shell.d/first-run-test.sh, provision-user-test.sh; test/acceptance.d/system-test.sh:114-127
merged-from: 42:firstrun-artefacts-present; 50:system-user-dirs-and-state; 42:xdg-defaults-and-home-layout; 61:provisioned-install-invariants

### provision-rerun-guards-force-replay-and-hooks-once   [VM-OK]
description: On a provisioned machine the first-login setup and user finalization are gated by completion markers: re-running them reports completion and does nothing, `--force` replays the steps and the welcome notification, the helpers refuse the wrong caller (root for user finalization, a user for the owner wizard) and unknown flags, and the post-update hooks fire their invitations exactly once.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy done check first-run-user; echo s=$?; omarchy-provision-first-run` → `s=0` and `First-run already complete (rerun with --force to refresh).`, returning at once.
  * Type `omarchy-provision-user; echo "rc=$?"` → `User finalization already complete (rerun with --force to refresh).` and `rc=0`. Type `omarchy-provision-user --help` → usage mentioning `--force`, `--first-install` and the marker `~/.local/state/omarchy/done/finalize-user`.
  ** Do not pass `--force` to `omarchy-provision-user`; that path downloads tools.
  ** The usage line should read `Usage: omarchy provision user` (the command was renamed from `finalize`); at HEAD it still says `Usage: omarchy finalize user` — record the stale string (03-INTENDED-BEHAVIOUR item 11, issue #7113), it is not a driver failure.
  * Type `sudo omarchy-provision-user; echo "rc=$?"` (password `prime`) → `Error: run omarchy-provision-user as the user being configured, not as root.` and `rc=1`. Type `omarchy-provision-owner; echo "rc=$?"` → `Error: omarchy-provision-owner must run as root`, `rc=1`. Type `sudo omarchy-provision-owner; echo exit=$?` → no output, `exit=0` (nothing pending; no wizard appears).
  ** If the owner wizard's logo appears, press Ctrl+C and report it — it must not start on a provisioned system.
  * Type `sudo ls -la /var/lib/omarchy/provisioning/ /var/lib/omarchy/provisioning/packages/` → `packages/` holds one `node-v*-linux-x64.tar.gz` (kept for a future factory reset); there is **no** `pending`, `wipe-pending`, `luks-key`, `authorized_keys` or `setup-user`. Type `sudo ls /etc/omarchy/provisioning.key /etc/limine-entry-tool.d/99-omarchy-provisioning-unlock.conf /etc/mkinitcpio.conf.d/99-omarchy-provisioning-key.conf 2>&1; systemctl status omarchy-provision-owner.service omarchy-system-factory-reset-finish.service --no-pager 2>&1 | head; grep -c cryptkey /proc/cmdline` → three `No such file or directory` lines, both units `could not be found`/not loaded, `0`.
  * The privileged apply commands refuse misuse the same way: type `omarchy-apply-hardware --install-user prime; echo $?` → `Error: omarchy-apply-hardware must run as root`, `1`; `sudo omarchy-apply-hardware` → `Error: --install-user must name the target non-root user`; `sudo omarchy-apply-hardware --install-user nobodyxyz` → `Error: user 'nobodyxyz' does not exist`; `sudo omarchy-apply-system --frobnicate` → `Unknown option: --frobnicate` followed by the usage text; `omarchy-apply-system --help; echo $?` → usage mentioning `--first-install|--upgrade`, `0`.
  ** Never run `sudo omarchy-apply-system --install-user prime …`; it re-runs the whole system configuration.
  * Unhappy path: type `omarchy-provision-first-run --bogus` → `Unknown option: --bogus` and the usage block; `omarchy-provision-user --nope; echo "rc=$?"` → `Unknown option: --nope`, usage, `rc=1`.
  * Type `ls ~/.config/omarchy/hooks/post-update.d/` → `install-voxtype.hook setup-fingerprint.hook setup-agent.hook` (the hooks first-run installed are still in place). Type `omarchy-hook post-update` → the Voxtype and default-agent invitation notifications appear (the fingerprint hook stays silent — no reader). Type `omarchy-hook post-update` again → no notification (one-shot done markers were written under `~/.local/state/omarchy/done/`; `ls` it and report the new entries).
  * Type `omarchy-provision-first-run --force` → within a few seconds a welcome notification appears; the command ends with `User finalization complete.`. Type `tail -n 12 ~/.local/state/omarchy/first-run.log` → `Starting:`/`Completed:` pairs for each step and no `Failed:`.
  ** A brief theme flicker is normal as settings are re-applied.
  * Close the terminal with Super+W. The hook markers persist on this disk: end the session with `stop` if it must stay pristine.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * `omarchy-hook post-update` is HEAD's shape; on 4.0.2 record `omarchy-version` and report "absent on this build" if the command is unknown.
  * Toasts fade in a few seconds; screenshot immediately after each hook run.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of `s=0` and both already-complete lines, the `--help` text (with the usage line as printed), the two caller refusals, the silent owner run, the provisioning directory with only `packages/` (and possibly `groups`) and the Node tarball, the three missing-file errors, the absent units and `0` for cryptkey, the four apply-command errors and the apply-system usage, both unknown-option usages, the hook listing, the invitation toasts on the first `omarchy-hook post-update` and none on the second, the welcome notification after `--force`, and the log tail with only Completed lines
  * If unsuccessful
  ** Any `Failed:` line (step and exit code), no notification, root finalization proceeding, the wizard starting, an unexpected `pending`/`luks-key` in the provisioning directory or a loaded provisioning unit, an apply command that proceeded past its guard (install-log lines appearing), the hooks firing twice, or a missing marker/hook
covers: bin/omarchy-provision-first-run, bin/omarchy-provision-user, bin/omarchy-provision-owner, bin/omarchy-done, bin/omarchy-apply-hardware, bin/omarchy-apply-system (argument parsing), install/provisioning/omarchy-provision-owner.service, install/user/first-run/enable-user-units.sh, docs/file-layout.md (Runtime finalization), omarchy-iso orchestrator stage_provisioning_state/_stage_node_tarball, test_provisioning_state.py, test/shell.d/provision-user-test.sh, first-run-test.sh, agent-invitation-test.sh (hook stays installed), fingerprint-invitation-test.sh (hook stays installed); 03-INTENDED-BEHAVIOUR.md item 11
merged-from: 24:provision-first-run-replay-and-guards; 42:provision-user-idempotent-and-root-refused; 51:first-run-already-complete; 21:apply-hardware-system-argument-guards; 42:provisioning-state-clean-on-installed-disk; 42:firstrun-force-rerun-toasts; 42:firstrun-offline-shows-wifi-toast

### hardware-detectors-and-commands-report-absence   [VM-PARTIAL]
description: On hardware the guest lacks, every detector answers "not this hardware" (except the virtual output, the host CPU and mesa ICDs), the commands built on them report the absence instead of acting, and the menu hides the matching rows: no laptop, fingerprint, hybrid-GPU or battery entries, no brightness OSD, a lid handler that never locks, Bluetooth quietly off, no webcam, and no fingerprint indicator on the lock screen.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `for h in asus-expertbook-b9406 asus-rog asus-zenbook-ux5406aa clamshell dell-xps13-sidecar-amps dell-xps-haptic-touchpad dell-xps-oled elgato-camlink-4k external-monitors fingerprint framework16 hybrid-gpu intel intel-ptl intel-sof laptop laptop-closed nvidia nvidia-gsp nvidia-without-gsp surface vulkan webcam; do timeout 5 omarchy-hw-$h >/dev/null 2>&1; echo "$h=$?"; done | sudo tee /dev/ttyS0` (password `prime`), then read `./client get-serial`.
  ** Expected: every line `=1` except `external-monitors=0` (QEMU's `Virtual-1` counts as external), `intel=0` on an Intel host under `-cpu host` (or 1 on AMD — report `grep -m1 vendor_id /proc/cpuinfo`), and `vulkan=0` if mesa ICDs are installed (report `ls /usr/share/vulkan/icd.d`). No line may be `=124` (timeout).
  * Run `omarchy-hw-display; echo $?; omarchy-hw-touchpad; echo $?; omarchy-hw-touchscreen; echo $?; omarchy-power-present; echo $?` → empty output (or a no-backlight error for display) and `1` each. Run `omarchy-hw-match "Standard PC"; echo $?; omarchy-hw-match XPS; echo $?; cat /sys/class/dmi/id/sys_vendor /sys/class/dmi/id/product_name /sys/class/dmi/id/chassis_type` → `0`, `1`, `QEMU` / `Standard PC (Q35 + ICH9, 2009)` / `1`. Run `lspci | grep -cE 'VGA|3D|Display'; command -v supergfxctl || echo absent` → `1`, `absent`.
  * Menu consequence: press Super+Space → Trigger → Hardware (also `Super+Ctrl+H`): either "Nothing here yet" or a list with no "Laptop Display", "Mirror Display", "Hybrid GPU" or "Touchpad" rows ("Touchscreen" is uncertain — the USB tablet may register as one; report). Trigger → Toggle: no "Battery Percentage". Setup → Security: Fido2, SSHD, Passwordless Sudo, Sudoless Docker but NO "Fingerprint". Screenshot each; Escape.
  * Run `omarchy battery status --shell; echo s=$?; omarchy brightness display; echo s=$?` → no `percentage` line, no battery/power widget in the bar, and a brightness error (exit 1, silently taking the DDC path) with no OSD on screen. Run `omarchy-windows-key; echo "exit=$?"` → `No Windows license key found in firmware.` and non-zero.
  * Run `omarchy-toggle-hybrid-gpu; echo s=$?; omarchy-setup-security-fingerprint; echo s=$?` → both fail promptly with a message; no pacman runs (if a sudo/pacman prompt appears instead of a refusal, press Ctrl+C and report it). Run `omarchy-capture-webcam-list; echo "exit=$?"` → no devices listed; `omarchy-capture-screenrecording-with-webcam` → a notification `No webcam devices found` and no recording started (`pgrep -f gpu-screen-recorder` empty).
  * Run `omarchy-toggle-input-device touchpad off; echo "exit=$?"; ls ~/.local/state/omarchy/toggles/hypr/touchpad-disabled-name 2>&1` → an error about no device, non-zero, and no such file. Run `omarchy-hyprland-monitor-clamshell; echo "exit=$?"; hyprctl monitors -j | jq '.[0].disabled'; omarchy-hw-recover-internal-monitor; echo $?` → returns without changing the display, `false`, `0`. Run `omarchy-system-lid-close; echo s=$?` → the desktop does NOT lock.
  * Run `bash ~/.config/omarchy/hooks/post-update.d/setup-fingerprint.hook; ls ~/.local/state/omarchy/done/fingerprint-setup-invitation 2>&1; systemctl --user status bt-agent.service | head -3; omarchy bluetooth power on; echo s=$?` → no toast and no marker; bt-agent inactive with its condition unmet; the power command returns without hanging.
  * Press Super+Ctrl+L — the lock screen has no fingerprint indicator (only the password field); type `prime` and Enter to unlock. Close the terminal with Super+W.
  ** Skipped in this VM: every positive hardware path (battery, backlight/DDC, enrolment, supergfx switch, real lid/clamshell, NVIDIA, webcam, Apple quirks).
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Any command here that runs longer than 10 s is a hang and should be reported. The detectors are the `when:` gates the menu relies on; one returning 0 in the VM would make the menu show rows the guest cannot use.
  * The lock screen blanks 5 s after the last input; the first character typed while black both wakes it and enters the field.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Serial dump with the full `name=code` list; screenshots of the DMI strings and `absent`, the menus without the gated rows, no battery widget or brightness OSD, the exact `No Windows license key found in firmware.` line, the prompt failures for hybrid-gpu/fingerprint, the `No webcam devices found` toast, the touchpad refusal with no state file, `false` for the monitor, no lock from the lid handler, the bt-agent condition, and a lock screen without a fingerprint indicator
  * If unsuccessful
  ** Any detector returning 0 unexpectedly (or 124), a hardware row shown, a state file written, the display disabled, a recording started, a hang, a crash toast, or the lid handler locking the screen
  ** Output of `omarchy-version`
covers: bin/omarchy-hw-* (all 28); bin/omarchy-hw-hybrid-gpu; bin/omarchy-toggle-hybrid-gpu (gating only); bin/omarchy-power-present; bin/omarchy-windows-key; bin/omarchy-capture-webcam-list; bin/omarchy-capture-screenrecording-with-webcam; bin/omarchy-toggle-input-device; bin/omarchy-hyprland-monitor-clamshell; default/omarchy/omarchy-menu.jsonc (when gates; trigger.hardware.hybrid-gpu); test/shell.d/hw-{display,external-monitors,fingerprint,hybrid-gpu,nvidia}-test.sh, hybrid-gpu-test.sh, brightness-display-test.sh, battery-status-test.sh, battery-test.sh, lid-close-test.sh, fingerprint-package-test.sh, fingerprint-invitation-test.sh, bluetooth-test.sh, lock-fingerprint-indicator-test.sh, power-present-test.sh, xps13-sidecar-amps-test.sh, windows-key-test.sh, screenrecording-test.sh, toggle-input-device-test.sh, monitor-clamshell-scale-test.sh, monitor-recovery-test.sh, power-test.sh; manual/12-screenshots-recording.md, 13-toggles-idle-screensaver.md, 34-keyboard-mouse-trackpad.md, 37-hardware-authentication.md
merged-from: 25:hw-detection-answers-in-qemu; 52:hardware-detectors-report-absence; 51:hardware-absence-paths; 25:hybrid-gpu-toggle-hidden-without-hardware

### hardware-quirks-inert-on-virtio   [VM-OK]
description: On a virtio VM none of the vendor/GPU/Apple hardware quirk scripts left configuration behind (no NVIDIA early KMS, no Vulkan/Intel media packages, no T2/Broadcom/SPI fixes, no laptop drop-ins), while the unconditional ones (hid_apple fnmode, bluetooth enable, networkd retirement) applied — a quirk misfiring on generic hardware would break boot or Hyprland.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `cat /sys/class/dmi/id/sys_vendor /sys/class/dmi/id/product_name; lspci | grep -iE 'vga|3d|display'` → `QEMU` / `Standard PC (Q35 …)` and a `Red Hat, Inc. Virtio 1.0 GPU` line (no NVIDIA/Intel/AMD).
  * Run `ls /etc/modprobe.d/; cat /etc/modprobe.d/hid_apple.conf` → `hid_apple.conf` present with `options hid_apple fnmode=2`; **none** of `nvidia.conf brcmfmac.conf iwlwifi-disable-eht.conf lenovo-yoga-pro7-bass.conf blacklist-clevo-xsm-wmi.conf v4l2loopback-exclusive-caps.conf`.
  * Run `ls /etc/mkinitcpio.conf.d/ /etc/limine-entry-tool.d/ /etc/udev/rules.d/ /etc/libinput/ 2>&1 | sudo tee /dev/ttyS0` (password `prime`) and read the serial → no `nvidia.conf`, `apple-t2.conf`, `surface_device_modules.conf`, `macbook_spi_modules.conf`, `t2-mac.conf`, `intel-panther-lake-fred.conf`, `asus-*.conf`, `71-elgato-camlink-4k.rules`, `99-omarchy-asus-z13-touchpad.rules`, `50-framework16-qmk-hid.rules`, `asus-expertbook-b9406.quirks`.
  * Run `pacman -Q nvidia-open-dkms nvidia-utils vulkan-intel vulkan-radeon intel-media-driver thermald intel-lpmd asusctl broadcom-wl-dkms 2>&1 | grep -c 'was not found'; pacman -Q linux-t2 t2fanrd apple-bcm-firmware; pacman -Q linux-omarchy` → `9`, three `was not found`, and linux-omarchy installed.
  * Run `lsmod | grep -cE 'applespi|apple_bce|brcmfmac'; uname -r; sudo grep -cE 'linux-t2' /boot/limine.conf` → `0`, a non-`t2` kernel, `0`.
  * Run `systemctl is-enabled bluetooth NetworkManager-wait-online systemd-networkd-wait-online iwd systemd-networkd 2>&1` → `enabled`, `masked`, `masked`, then disabled/not-found for iwd and systemd-networkd.
  * Run `grep -c no_hardware_cursors ~/.config/hypr/looknfeel.lua; ls /etc/systemd/system/omarchy-nvme-suspend-fix.service 2>&1; cat /etc/conf.d/wireless-regdom | grep -v '^#' | grep .; timedatectl show -p Timezone --value` → `0`, `No such file`, and report whether `WIRELESS_REGDOM` is set and to what (expected only when the timezone maps to a country).
  * Unhappy path: run `omarchy-hw-nvidia; echo $?; omarchy-hw-asus-rog; echo $?; omarchy-hw-laptop; echo $?` → `1 1 1`. Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Long listings: pipe to `| sudo tee /dev/ttyS0` and read via ./client get-serial. Observational; the interesting failure is a vendor-only package, module or drop-in leaking into every install.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots/serial of the DMI vendor and virtio GPU line, the modprobe/mkinitcpio/limine/udev listings without vendor files, `9` and three not-found packages, `0` modules with the kernel name and `0` t2 entries, the service states, the regdom report, and the three `1` exit codes
  * If unsuccessful
  ** The listing containing an unexpected vendor drop-in, any T2/Apple package, module or boot entry, or a vendor package present on the QEMU guest
covers: install/hardware/** (every leaf); install/hardware/apple/*.sh; bin/omarchy-apply-hardware; install/user/hardware/**; bin/omarchy-hw-*; agents/skills/install-scripts.md; etc/limine-entry-tool.d/omarchy-defaults.conf BOOT_ORDER; manual/44:37, 44:71
merged-from: 42:hardware-quirks-inert-on-virtio; 13:mac-hardware-fixes-absent-on-non-mac

### hardware-restart-entries-run-without-devices   [VM-PARTIAL]
description: The "Update → Hardware" reloads for Wi-Fi, Bluetooth, Audio and Trackpad each run to "Done!" even with no such device present, and the audio stack comes back — the software path of the troubleshooting advice (device recovery itself skipped).
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Omarchy Menu with Super+Space, click Update → Hardware: Audio, Wi-Fi, Bluetooth, Trackpad are listed (these rows have no hardware guards and stay visible).
  * Click Wi-Fi: `Unblocking wifi...`, an empty `rfkill list wifi`, "Done! Press any key to close...". Press a key.
  * Update → Hardware → Bluetooth: `Unblocking bluetooth...`, empty list, Done. Press a key.
  * Update → Hardware → Audio: `Restarting audio services...`, then `Audio status:` with a `wpctl status` tree whose Sinks/Sources are empty, Done. It must not say `Audio services are still not responding`. Press a key.
  * Update → Hardware → Trackpad: password `prime`; no devices, Done. Press a key.
  * Open a terminal with Super+Enter and type `systemctl --user is-active pipewire wireplumber pipewire-pulse`: three `active` — the audio stack came back. Close the terminal with Super+W.
  ** Skipped: recovering a real Wi-Fi, Bluetooth, audio or trackpad device.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * "Failed (exit code N)!" on any entry is the finding — capture exit code and output.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the submenu and of each terminal ending in Done (Audio showing the wpctl tree), and the three `active` user services
  * If unsuccessful
  ** A Failed line, "Audio services are still not responding", or a missing entry
covers: manual/45:27; bin/omarchy-restart-wifi, -bluetooth, -audio, -trackpad; omarchy-menu.jsonc update.hardware.*
merged-from: 13:hardware-restart-entries-run-without-devices

### audio-tuning-no-matching-hardware   [VM-PARTIAL]
description: On a machine with no matching speaker tuning — and in the guest no audio device at all — `omarchy audio tuning status|on|off` answer cleanly, write nothing and leave the tuning service inactive, and a bogus verb prints usage; applying a tuning needs the matching Dell hardware and is skipped.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy audio tuning status; echo "exit=$?"` → a status block `Installed:    no`, `Host service: inactive (disabled)` (or `not-found` — report), `Tuning sink:  absent`, `Default sink: auto_null`, `Matches:      nothing ships for this laptop`; note the exit code. Bare `omarchy-audio-tuning` prints the same block.
  * Type `omarchy-audio-tuning match; echo $?; omarchy-audio-tuning fronted-sink; echo $?` → empty and `1`, twice.
  * Type `omarchy audio tuning on; echo "exit=$?"` → `No speaker tuning matches this laptop.` (reviewers disagree on the exit code — 25 expects `0`, 61 non-zero; record it); then `ls ~/.config/pipewire/ 2>&1` → no `omarchy-speaker-tuning` entries; `systemctl --user is-active omarchy-speaker-tuning.service` → `inactive`.
  * Type `omarchy audio tuning off; echo "exit=$?"` → `No speaker tuning installed.`; report the exit code (expected `0`).
  * Unhappy path: type `omarchy audio tuning dance; echo "exit=$?"` → usage, `exit=2`.
  * Type `ls /usr/share/omarchy/default/audio/tunings/` → the shipped tuning directories (e.g. `dell-xps-14`); `head -12 /usr/share/omarchy/default/audio/tunings/*/tuning.conf` → `match_sku`/`sink_pattern` and the measurement fields. `ls ~/.config/systemd/user/ 2>&1 | grep -c speaker-tuning` → `0` (nothing written).
  * Close the terminal with Super+W.
  ** Skipped: applying a tuning (needs matching Dell hardware and a real sink).
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The guest has no sound card, so the audio bar widget may show muted/no device (the `auto_null` Dummy Output); that is expected and not a failure of this test.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the status block, `match`/`fronted-sink` exits, the on/off messages with exit codes, the empty pipewire and systemd user dirs and `inactive`, the usage error with `exit=2`, and the shipped tuning listing
  * If unsuccessful
  ** Any file created under `~/.config/pipewire` or `~/.config/systemd/user`, an audio restart triggered, or a crash; `journalctl --user -u omarchy-speaker-tuning -n 20`
covers: docs/audio-tuning.md (commands, gating on match, verification and rollback, service); bin/omarchy-audio-tuning; bin/omarchy-audio-output-sink; bin/omarchy-audio-sink-availability
merged-from: 61:audio-tuning-no-matching-hardware; 25:audio-tuning-no-match-paths

### wifi-helpers-and-qr-absent-on-wired   [VM-PARTIAL]
description: Without a Wi-Fi radio the QR share entry is hidden from the menu and the network panel (which shows the wired connection with the expected Ping "Timeout" on user-mode NAT), the band/password/QR helpers fail with their specific messages and never crash, and a forced summon of the QR overlay shows an error card rather than a bogus code.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Space → Setup → Network. The only row is DNS — NO "QR Code". Press Escape.
  * Press Super+Ctrl+W (the network panel; also `Super+Ctrl+1`): the hero has no QR button, no Wi-Fi switch, band or network list — only the wired connection. Ping `Timeout` / Packet Loss `100%` in red is the expected reading (ICMP is dropped by user-mode NAT), not a failure. Press Escape.
  * Press Super+Enter and type `omarchy-network-status; ip route get 1.1.1.1 | awk '{for(i=1;i<=NF;i++) if($i=="dev") print $(i+1)}'; nmcli radio wifi; nmcli device status` Enter → the wired interface line and its name (e.g. `enp0s2` or `ens3`); `enabled`/`disabled` with no device; no wifi rows.
  * Type `omarchy-network-band; echo $?; omarchy-network-band 5; echo $?; omarchy-network-band 7; echo $?; omarchy-network-band 5 6; echo $?` Enter → nothing and `0`; `Error: no connected Wi-Fi device.` and `1`; `Usage: omarchy-network-band [auto|2.4|5|6]` and `1`; usage and `1`.
  * Type `omarchy-network-password wlan9; echo $?; omarchy-network-password nosuch0; echo $?; omarchy-network-password; echo $?; omarchy-network-password $(omarchy-network-status | cut -f2); echo $?` Enter → `No active Wi-Fi connection` and `1`; an nmcli error plus `No active Wi-Fi connection` and `1`; the `${1:?Usage…}` message and `1`; `This network has no password` (or `No active Wi-Fi connection` / `Could not read the Wi-Fi password`) and `1` for the wired interface — never a password.
  * Type `omarchy-network-qr; echo $?; omarchy-network-qr --meta wlan9; echo $?` Enter → `No active Wi-Fi connection` and `1`, twice.
  * Type `omarchy-shell shell summon omarchy.wifiqr` Enter → a dark overlay titled "WI-FI", briefly "Generating QR code…", then a red error line (no Wi-Fi connection / "Could not generate the Wi-Fi QR code"). No white QR square, no "Show password". Press Escape: the overlay closes. Type `exit` and Enter.
  ** Skipped on this VM: the rendered code for a connected Wi-Fi network, the password reveal, and band pinning.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The panel's Ping/Packet Loss readings are red by design here; do not report them as a failure.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Setup › Network without QR Code; the network hero without a QR button and with the wired connection; the terminal with each helper message and exit code; the wifiqr overlay with the red error; the desktop after Escape
  * If unsuccessful
  ** Any helper that printed a QR matrix or a password on a wired-only VM, a helper hanging or exiting 0 where an error was expected, a QR square rendered without Wi-Fi, an overlay that will not close, or a crash
covers: bin/omarchy-network-band, bin/omarchy-network-password, bin/omarchy-network-qr, bin/omarchy-network-status; shell/plugins/panels/wifiqr/Panel.qml (error path), Model.js; shell/plugins/panels/network/Panel.qml (canShareWifi); default/omarchy/omarchy-menu.jsonc (setup.network.qr when-guard); test/shell.d/network-password-test.sh, network-qr-test.sh, wifiqr-test.sh; manual/35-networking.md (Sharing your Wi-Fi, Pinning the Wi-Fi band)
merged-from: 31:wifi-qr-absent-on-wired; 25:network-wifi-helpers-absent; 12:network-wifi-cli-without-wifi

### sudo-wrong-password-retries-and-narrow-nopasswd-rules   [VM-OK]
description: `sudo` asks for the account password, refuses a wrong one with "Sorry, try again." and keeps asking for up to ten tries (not stock three), caches the credential, and lists only the few narrow passwordless rules Omarchy grants (DNS presets, `timedatectl set-timezone`, the browser colour) — no blanket grant such as the old asdcontrol drop-in.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter and type `sudo -k; sudo -n true 2>&1; echo rc=$?` Enter → `sudo: a password is required`, `rc=1`.
  * Type `sudo true` Enter. At `[sudo] password for prime:` type `wrong1` Enter → `Sorry, try again.`; `wrong2` → same; `wrong3` → same; a FOURTH prompt must still appear (stock sudo gives up after 3). Type `prime` Enter: the command succeeds silently. Type `echo $?` → `0`.
  ** Stop at three wrong attempts: faillock (`deny=10`, shared with the lock screen and SDDM) counts sudo failures too.
  * Type `sudo -n true; echo rc=$?` Enter → `rc=0` (credential cached).
  * Type `sudo -l | grep -E 'NOPASSWD|passwd_tries'` Enter → `passwd_tries=10` and NOPASSWD lines for `omarchy-dns Cloudflare/Google/DHCP`, `timedatectl ^set-timezone …`, `omarchy-theme-set-browser-policy […]` — and nothing else.
  * Type `sudo ls /etc/sudoers.d/; sudo test -e /etc/sudoers.d/omarchy-asdcontrol; echo rc=$?` Enter → the Omarchy drop-ins with no `omarchy-asdcontrol` entry, and `rc=1`.
  * Type `sudo -k; sudo true` Enter and press Ctrl+C at the prompt: sudo exits without running. Type `sudo -k; sudo -n true 2>&1; echo rc=$?` → a password-required error and `rc=1`.
  * Type `sudo faillock --user prime --reset` Enter (password `prime`), then `sudo -k`. Press Ctrl+D; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Passwords are not echoed; count Enter presses. Three wrong + one right stays well under the faillock limit.
  * The sudo prompt appears inline in the terminal; type `prime` and Enter.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of three "Sorry, try again." lines followed by a fourth prompt and success with `prime`, the cached `rc=0`, the rule listing, the sudoers.d listing without asdcontrol with `rc=1`, and the password-required error after `sudo -k`
  * If unsuccessful
  ** sudo giving up after 3 ("3 incorrect password attempts"), accepting a wrong password, a lockout, the asdcontrol file existing, or `sudo -n true` succeeding after `sudo -k`
covers: etc/sudoers.d/omarchy-passwd-tries; etc/sudoers.d/*; etc/security/faillock.conf; manual/45:39; manual/48:13; test/acceptance.d/security-test.sh:45-52,104-108
merged-from: 41:sudo-password-prompt-and-retries; 13:sudo-rejects-wrong-password-then-accepts; 50:security-no-asdcontrol-sudoers

### passwordless-sudo-toggle-expiry-and-guards   [VM-OK]
description: Setup → Security → Passwordless Sudo (`omarchy sudo passwordless`) warns, asks to confirm, grants blanket NOPASSWD sudo with an expiry timer, expires on its own without any user action, and a second run revokes it early; declining the warning and non-numeric minutes change nothing.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `sudo -k; sudo -n true; echo "exit=$?"` → `exit=1` (sudo needs a password). Type `omarchy-sudo-passwordless abc; echo "exit=$?"` → `Usage: omarchy-sudo-passwordless [MINUTES]` and `exit=1`, no sudo prompt; `omarchy-sudo-passwordless 5x; echo "exit=$?"` → same usage, `exit=1`.
  * Open the Omarchy Menu with Super+Space, click Setup → Security → Passwordless Sudo with the mouse. The floating terminal prints `Toggle passwordless sudo...`, asks the sudo password (`prime`), shows the `⚠️ WARNING` block about `ANY command as root WITHOUT a password for 15 minutes` and `Enable passwordless sudo for 15 minutes? This is a significant security risk!`. Choose **No** → `Aborted. No changes made.`, then Done!; press a key. In the terminal `sudo -k; sudo -n true; echo "exit=$?"; ls /etc/sudoers.d/` → `exit=1` and no `nopasswd` file.
  * Repeat Setup → Security → Passwordless Sudo, choose **Yes** → `Passwordless sudo has been ENABLED. It will automatically disable in 15 minutes.`, `A restart removes the passwordless sudo rule as well.`, Done!; press a key. Type `sudo -k; sudo -n true; echo "exit=$?"; systemctl list-timers 'omarchy-nopasswd-expire-*' --no-pager; sudo cat /etc/sudoers.d/99-omarchy-nopasswd-prime` → `exit=0`, one timer about 15 min out, and `prime ALL=(ALL) NOPASSWD: ALL`.
  * Type `omarchy-sudo-passwordless 1` → `Passwordless sudo timer updated. It will now automatically disable in 1 minutes.`
  * Every 5 seconds type `sudo -k; sudo -n true; echo "exit=$?"` and screenshot until it flips to `exit=1` (about 60–70 s, with no command from you). Then `ls /etc/sudoers.d/` → `99-omarchy-nopasswd-prime` has disappeared (`omarchy-tzupdate` and the others stay); `systemctl list-timers --all | grep -ci nopasswd` → `0` (the timer is gone too).
  * Type `omarchy-sudo-passwordless`, choose Yes, `prime` → ENABLED again (15 min); confirm `sudo -n true` succeeds; then open Setup → Security → Passwordless Sudo once more with the mouse → the floating terminal prints `Passwordless sudo has been DISABLED. Sudo will require a password again.` Type `sudo -k; sudo -n true; echo "exit=$?"; ls /etc/sudoers.d/` → `exit=1` and no `99-omarchy-nopasswd-prime` — back where it started.
  * Close the terminal with Super+W; the desktop is as before and sudo asks for a password.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * `sudo -n` never prompts, so it is a clean probe; `sudo -k` first drops the cached credential so it tests the rule, not the timestamp. Enabling always costs one password: the script uses sudo to write the rule.
  * gum confirm highlights `Yes` first; use Left/Right or Tab then Enter. The expiry wait is twelve to fourteen 5 s screenshots; never a single long sleep.
  * The floating terminal closes when the command ends; screenshot as soon as the ENABLED/DISABLED line appears, or run `omarchy-sudo-passwordless` from the normal terminal to read it at leisure.
  * The sudo-expiry fail-closed guard may be missing on the 4.0.2 disk (build drift): record `omarchy-version` with any failure.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of both usage errors with `exit=1`, the WARNING with No → `Aborted. No changes made.` and the `exit=1` probe with no rule file, the menu-launched ENABLED message, `exit=0` with the timer and the `prime ALL=(ALL) NOPASSWD: ALL` rule, the 1-minute update, the poll where `exit` flips to 1 with the rule file and timer gone, the menu-launched DISABLED message, and the final `exit=1` with the file gone
  ** The menu was operated with the mouse
  * If unsuccessful
  ** `Failed to schedule passwordless sudo expiry. Revoking access now.` / `CRITICAL: Could not remove …`, `ENABLED` printed without a timer, the rule surviving past the timer, `sudo -n` still succeeding after DISABLED, a rule file after No, or a usage error that prompted for sudo
  ** Output of `omarchy-version`
covers: manual/48:23-25; manual/48-security.md; manual/18-development-tools.md; bin/omarchy-sudo-passwordless:16-27,60-67; etc/tmpfiles.d/omarchy-nopasswd-sudo.conf; default/omarchy/omarchy-menu.jsonc:185 (setup.security.passwordless-sudo); test/shell.d/nopasswd-sudo-expiry-test.sh; test/shell.d/menu-test.sh
merged-from: 13:passwordless-sudo-enable-expire-and-disable; 13:passwordless-sudo-rejects-bad-minutes-and-cancel; 20:sudo-passwordless-enable-disable; 20:sudo-passwordless-expires-on-timer; 24:sudo-passwordless-toggle-and-expiry; 41:passwordless-sudo-toggle-expiry; 52:passwordless-sudo-expires-on-its-own; 52:passwordless-sudo-toggle-from-menu

### timezone-menu-change-passwordless-and-rule-variants   [VM-OK]
description: "Update → Timezone" changes the zone with no password (the `omarchy-tzupdate` sudoers rule, present since 4.0.2), the bar clock follows at once, cancelling the picker changes nothing, "Update → Time" restarts time sync with the password, and only the exact `timedatectl set-timezone <Zone>` form is passwordless — extra flags, other subcommands and junk zones ask for a password or fail harmlessly.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `sudo -k; timedatectl show -p Timezone --value` Enter; write down the value (ORIGINAL).
  * Open the Omarchy Menu with Super+Space, click Update → Timezone. A `Set timezone` picker opens. Press Esc: it closes and the bar clock is unchanged.
  * Update → Timezone again; type `Auckland`, select `Pacific/Auckland`, Enter. NO password prompt. A notification `Timezone is now set to Pacific/Auckland` appears and the clock jumps by the offset. Type `timedatectl show -p Timezone --value` → `Pacific/Auckland`.
  * Update → Time: the floating terminal prints `Updating time...`, asks `[sudo] password for prime:` → `prime`, then "Done!". Press a key.
  * Type `sudo -k; sudo -n timedatectl set-timezone Pacific/Kiritimati; echo rc=$?` Enter → no password prompt, `rc=0`, and the bar clock jumps within a few seconds (UTC+14).
  * Type `sudo -n timedatectl set-timezone -H localhost Europe/Paris; echo rc=$?; sudo -n timedatectl set-timezone 'Bad;Zone'; sudo -n timedatectl set-time '2020-01-01 00:00:00'; sudo -n timedatectl set-timezone 'UTC -H'` Enter → each `a password is required` (`rc=1` for the first): extra flags, junk zones, other subcommands and padded arguments are not matched.
  * Type `sudo -n timedatectl set-timezone Not/AZone; echo rc=$?` Enter → no prompt (the pattern matches) but `Failed to set time zone: Invalid time zone` and a non-zero rc; the zone stays Kiritimati.
  * Restore: Update → Timezone, type ORIGINAL, Enter (or `sudo -n timedatectl set-timezone <ORIGINAL>`, no prompt) → notification and the clock back as it started. Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The picker is the Omarchy menu in select mode and filters as you type. A sudo or polkit password prompt on the timezone change is a failure (the sudoers grant is shipped).
  * The bar clock is the visible proof of each change; screenshot the whole screen, not just the terminal.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the picker, the Esc cancel with the unchanged clock, the notification and shifted clock with `Pacific/Auckland`, the Update → Time terminal with password prompt and Done, the prompt-free `rc=0` change with the clock before/after, each "a password is required" line, the invalid-zone error, and the restored clock
  * If unsuccessful
  ** A sudo/polkit prompt on the plain form or the menu change, a flagged form or `set-time` accepted without one, no notification, or the clock not moving
  ** Output of `omarchy-version`
covers: manual/46:31; manual/05-the-top-bar.md; manual/46-faq.md; bin/omarchy-menu-timezone; bin/omarchy-update-time; etc/sudoers.d/omarchy-tzupdate; omarchy-menu.jsonc update.timezone / update.time; test/shell.d/timezone-test.sh
merged-from: 13:faq-timezone-picker-and-time-resync; 52:timezone-change-without-password; 41:timezone-sudo-rule-rejects-variants

### privileged-command-without-terminal-fails-cleanly   [VM-OK]
description: A sudo-requiring Omarchy command launched with no terminal fails with sudo's clear message and does nothing, while the one command built for that case (`omarchy-dns`) still works through its passwordless grant.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `sudo -k; sudo snapper list` (password `prime`); note the row count; type `sudo -k`.
  * Type `setsid -f bash -c 'omarchy-snapshot create >/tmp/no-tty.log 2>&1'`, wait 5 s, then `cat /tmp/no-tty.log`: it must contain `sudo: a terminal is required to read the password…` and must NOT contain "Create system snapshot".
  * Type `sudo snapper list` (password `prime`): row count unchanged.
  * Type `sudo -k; setsid -f bash -c 'omarchy-dns Google >/tmp/dns.log 2>&1'`, wait 5 s, `cat /tmp/dns.log; omarchy dns`: no sudo error and `Google`.
  * Type `omarchy dns DHCP` then `omarchy dns`: `DHCP` — back to stock. Type `rm /tmp/no-tty.log /tmp/dns.log`; close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * `setsid -f` detaches the command from the terminal so sudo has no tty — that is the point of the test. Wait with screenshots, not a long sleep.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of `/tmp/no-tty.log` with "a terminal is required" and unchanged snapper rows; `omarchy dns` showing Google after the tty-less run, then DHCP
  * If unsuccessful
  ** A snapshot created without a password, a hung `sudo` (`pgrep -a sudo`), or an empty log after 15 s
covers: bin/omarchy-snapshot (requires-sudo); bin/omarchy-dns require_root; etc/sudoers.d/omarchy-dns; 13-manual-rest.md Observations #12
merged-from: 13:privileged-command-without-terminal-fails-cleanly

### git-url-check-refuses-hostile-urls   [VM-OK]
description: The `omarchy git url check` guard behind theme and plugin installs accepts every normal clone URL silently and refuses URLs that would make git run a program (`ext::`, `fd::`, unknown `scheme://`, option-shaped strings) with a named reason before any clone; `omarchy-plugin-add` applies it plus its own argument checks and never leaves a temp dir behind.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `for u in https://github.com/omacom/omarchy.git git@github.com:omacom/omarchy.git ssh://git@github.com/acme/repo.git 'ssh://git@[2001:db8::1]:22/org/repo.git' file:///home/prime/repo ./repo; do omarchy-git-url-check "$u"; echo "s=$?"; done` → `s=0` six times and no other output.
  * Type `omarchy git url check 'ext::sh -c id'; echo "exit=$?"` → `omarchy-git-url-check: 'ext::sh -c id' names a git option or transport helper, not a repository.`, `exit=1`. Type `omarchy git url check --upload-pack=id; echo "exit=$?"` → the same "names a git option or transport helper" refusal, `exit=1`.
  * Type `omarchy git url check foo://example.com/x; echo "exit=$?"` → `… names the 'foo' transport, which Omarchy does not clone from.`, `exit=1`. Type `omarchy-git-url-check; echo "exit=$?"` → `omarchy-git-url-check: a git URL is required`, `exit=1`.
  * Type `for u in 'fd::0,1' 'HTTPS://github.com/a/b' '--upload-pack=touch /tmp/pwned' ''; do omarchy-git-url-check "$u"; echo "s=$?"; done; ls /tmp/pwned` → four non-zero statuses and `ls` fails.
  * Plugin installer, echoing `$?` after each: `omarchy-plugin-add 'ext::sh -c id' --yes` → the helper refusal, 1; `omarchy-plugin-add --upload-pack=id --yes` → `unknown add option: --upload-pack=id`, 1; `omarchy-plugin-add 'gopher://example.org/repo' --yes` → `… names the 'gopher' transport, which Omarchy does not clone from.`, 1; `omarchy-plugin-add 'fd::3' --yes` → helper refusal, 1; `omarchy-plugin-add file:///tmp/nonexistent --yes` → git error then "failed to clone", 1; `omarchy-plugin-add file:///tmp/nonexistent < /dev/null` (no --yes, no TTY) → `refusing to continue without confirmation; pass --yes`, 1; `omarchy-plugin-add one two --yes` → `unexpected argument: two`, 1; `omarchy-plugin-add --help` → usage, 0. Then `ls -a ~/.config/omarchy/plugins/` → no `.add.tmp.*` leftovers.
  * Press Super+Space → Install → Style → Theme — a floating terminal asks for a repository URL. Type `ext::sh -c id` and Enter → `'ext::sh -c id' names a git option or transport helper, not a repository.`; the installer stops; screenshot quickly. Repeat via the menu with `zzz://a` → `'zzz://a' names the 'zzz' transport, which Omarchy does not clone from.`
  ** The floating terminal closes right after the message; run `omarchy-theme-install` in the normal terminal instead if you need time to read it.
  * Type `omarchy plugin add https://example.com/x.git` (no `--yes`) → the warning `⚠️  Plugins run as arbitrary, unsandboxed code inside your long-lived omarchy-shell process…` with `URL: https://example.com/x.git` and `Clone and add this plugin?`; answer **No** → `omarchy-plugin-add: aborted`, nothing cloned.
  * Press Super+Space → Setup → Plugins → Add Plugin → the floating terminal asks `Git URL of the plugin repo:`; type `ext::sh -c id`, Enter → the same helper refusal. Reopen it and press Escape (or Ctrl+C) at the prompt → `omarchy-plugin-add: cancelled` and Failed exit 1 (or the window closes on Ctrl+C). Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Accepted URLs print nothing — the `exit=0` line is the proof. Nothing is cloned in this test, so it needs no network. Quote the odd URLs exactly as shown; the point is that they never reach git.
  * The transport-helper checks may be missing on the 4.0.2 disk (build drift): record `omarchy-version` with any failure so drift is separable from regression.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots with the six `s=0` lines, the four named refusals with `exit=1`, non-zero for every hostile form and no `/tmp/pwned`, each plugin-add message with exit 1 (usage with 0) and a clean plugins directory, the unsandboxed-code warning declined with `aborted`, both installer refusals verbatim from the menu, and the `cancelled` exit
  * If unsuccessful
  ** `ext::` accepted (exit 0 or clone output such as `uid=1000` or `Cloning into`), an https URL refused, a URL that reached `git clone`, or a leftover temp dir
  ** Output of `omarchy-version`
covers: bin/omarchy-git-url-check; bin/omarchy-plugin-add; bin/omarchy-theme-install; test/shell.d/git-url-check-test.sh; test/shell.d/plugin-add-test.sh; manual/43-making-your-own-theme.md; manual/32-shell-plugins.md (Adding a plugin from git); omarchy-menu.jsonc setup.plugin.add
merged-from: 20:git-url-check-accepts-and-refuses; 51:git-url-check-refuses-transport-helpers; 25:plugin-add-rejects-unsafe-urls; 12:plugin-add-rejects-bad-urls

### sshd-setup-key-hardens-login-and-removes   [VM-OK]
description: A user turns SSH on from Setup → Security → SSHD by pasting a public key from the clipboard (or with `--key=…`): sshd starts, port 22 opens rate-limited in ufw, the key is authorized and a hardening drop-in turns password and keyboard-interactive logins off, so a key login to localhost works and a password-only attempt is refused; a rerun is idempotent and Remove → Security → SSHD closes everything again.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `ssh-keygen -t ed25519 -N '' -f ~/.ssh/tkey -q && wl-copy < ~/.ssh/tkey.pub && systemctl is-enabled sshd; sudo ufw status | grep -c 22` (password `prime`) → sshd `disabled`, `0` rules for 22; the public key is now on the clipboard.
  * Open the Omarchy Menu with Super+Space, click Setup → Security → SSHD. Enter `prime` at the sudo prompt. Expect `Setting up SSH server access with key-based authentication.`, `Installing and starting the OpenSSH server...`, `Opening the SSH port in the firewall (rate limited against brute force)...`, then the chooser `How would you like to add your SSH key?` — pick `Paste key manually`. At `Public key>` paste with Ctrl+Shift+V and press Enter → `Authorized key: 256 SHA256:… (ED25519)`, `Disabling SSH password authentication, now that a key is authorized...`, `Perfect! The SSH server is running and your key is authorized.`, `Password logins are off; this machine now accepts authorized keys only.`, `You can now connect with: ssh prime@omarchy`, then "Done!". Press a key.
  ** Hover the floating "Omarchy" terminal (mouse move) before pasting so the keys go there. If the paste lands nothing, type `cat ~/.ssh/tkey.pub` in your terminal, select the text, press Super+C and retry. openssh is already installed, so no download happens; allow up to 3 minutes, screenshot every 5 seconds.
  * Type `systemctl is-active sshd.service; grep -c -xF "$(cat ~/.ssh/tkey.pub)" ~/.ssh/authorized_keys; sudo cat /etc/ssh/sshd_config.d/10-omarchy-hardening.conf` → `active`, `1`, and a drop-in holding `PasswordAuthentication no` and `KbdInteractiveAuthentication no`.
  * Type `sudo ufw status | grep 22; sudo sshd -T | grep -iE '^(passwordauthentication|kbdinteractiveauthentication)'` → `22/tcp LIMIT Anywhere # omarchy-sshd` and both keywords `no`.
  ** OpenSSH 10.x may print the keywords in CamelCase; the values are what matter.
  * Type `ssh -o StrictHostKeyChecking=no -o BatchMode=yes -i ~/.ssh/tkey prime@localhost 'echo key-login-ok'` → `key-login-ok` with no password prompt.
  * Unhappy path: type `ssh -o StrictHostKeyChecking=no -o PubkeyAuthentication=no -o PreferredAuthentications=password -o ConnectTimeout=5 prime@localhost true 2>&1; echo rc=$?` → `Permission denied (publickey).` and a non-zero rc with no `password:` prompt at all.
  ** If a password prompt appears, press Ctrl+C and report it; do not type the password — that is the failure this test guards.
  * Type `omarchy-setup-security-sshd --key="$(cat ~/.ssh/tkey.pub)"; echo rc=$?` → the same setup lines with `Key already authorized: …` and `rc=0` (idempotent; the `--key` form avoids transcribing a key). Press Super+Space → Remove → Security: an SSHD row is now listed (visible only while sshd is enabled). Escape.
  * Revert: Super+Space → Remove → Security → SSHD, password `prime`; at `Also remove all authorized SSH keys…?` choose **Yes** → `Authorized keys removed.`, `The SSH server has been disabled and its firewall port closed.`, "Done!". Type `systemctl is-enabled sshd; sudo ufw status | grep -c 22; ls ~/.ssh/authorized_keys 2>&1` → `disabled`, `0`, `No such file`. Reopen Remove → Security: SSHD is no longer listed. Type `rm -f ~/.ssh/tkey ~/.ssh/tkey.pub`; close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * ufw's rule for 22 does not block localhost, so the loopback ssh test works regardless. The first sudo asks for `prime`.
  * Answer `yes` if ssh asks about the localhost host key even with `StrictHostKeyChecking=no`. `./client-with-image` after each Enter speeds up reading the long wizard output.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the chooser, the pasted key accepted and the wizard output ending in `Password logins are off`, `active` and `1` with the drop-in contents, the LIMIT rule and both `no` lines, `key-login-ok`, `Permission denied (publickey).` with no password prompt, the idempotent `--key` rerun with `rc=0`, the Remove → Security SSHD row, the removal output and post-removal checks, and Remove → Security without SSHD
  * If unsuccessful
  ** The wizard output at the failing line (`Not a valid SSH public key`, `sshd rejected the hardening config`, `did not apply the password-authentication restrictions`), a password prompt from ssh, `Password logins are off` printed while `sshd -T` still says `yes`, a 22 rule surviving removal, `sudo sshd -T | grep -i auth`, `sudo ufw status`, and `journalctl -u sshd | tail | sudo tee /dev/ttyS0` read via the serial log
  ** Output of `omarchy-version`
covers: bin/omarchy-setup-security-sshd, bin/omarchy-remove-security-sshd, install/config/firewall.sh (22 closed by default), default/omarchy/omarchy-menu.jsonc (setup.security.sshd, remove.security.sshd), test/shell.d/setup-security-sshd-test.sh, test/shell.d/sshd-hardening-migration-test.sh, test/acceptance.d/security-test.sh:54-115, manual/48:6, manual/48-security.md, manual/35-networking.md, manual/51 (SSH access)
merged-from: 42:setup-sshd-key-flag-hardens; 50:security-sshd-hardening; 13:sshd-setup-paste-key-then-remove; 24:setup-sshd-key-only-login-localhost; 52:sshd-setup-hardens-password-logins

### sshd-setup-rejects-bad-arguments-and-bad-key-before-opening-port   [VM-OK]
description: SSHD setup fails fast on malformed flags before touching the machine or sudo, and must reject a bad key, an empty pasted key or a cancel at the key picker *before* anything is installed or opened — sshd stays disabled and port 22 closed ("ssh is off until you turn it on"); at HEAD the code enables sshd and opens 22 first, leaving a cancelled or failed run half-hardened with password logins on (03-INTENDED-BEHAVIOUR item 2: DEFECT), so the observed state is recorded as the defect.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `systemctl is-enabled sshd; sudo ufw status | grep -c 22` (password `prime`): `disabled` and `0`. Type `sudo -k`.
  * Type `omarchy-setup-security-sshd --gh-keys; echo "exit=$?"`: `--gh-keys needs a GitHub username.` and `exit=2`, with no sudo prompt.
  * Type `omarchy-setup-security-sshd --key=x --gh-keys dhh; echo "exit=$?"`: `pass either --key or --gh-keys, not both.`, `exit=2`. Type `omarchy-setup-security-sshd --bogus; echo "exit=$?"`: `unknown option '--bogus'. Try --help.`, `exit=2`. None of these may print `Installing and starting`. Type `systemctl is-enabled sshd`: still `disabled`.
  * Type `omarchy-setup-security-sshd --key="not-a-key"; echo "exit=$?"`, password `prime`: the red `Not a valid SSH public key: not-a-key` and `exit=1`; `ls ~/.ssh/authorized_keys 2>&1` → still absent.
  * Type `systemctl is-enabled sshd; systemctl is-active sshd; sudo ufw status | grep 22; ls /etc/ssh/sshd_config.d/`.
  ** Intended (the script's own rule — reject bad input before anything is installed or opened): `disabled`, `inactive`, no `22/tcp` rule, no Omarchy drop-in.
  ** Observed at HEAD (the known defect): sshd `enabled`/`active`, `22/tcp LIMIT`, and `sudo sshd -T | grep -i passwordauthentication` → `passwordauthentication yes` (password logins left on). Capture every line exactly and report it as the item-2 defect, not as a driver error. If sshd is active, type `omarchy-remove-security-sshd` (No to removing keys) before the next step so each path starts from `disabled`.
  * Menu path: open the Omarchy Menu with Super+Space → Setup → Security → SSHD (mouse). Enter `prime` for sudo. At `How would you like to add your SSH key?` choose **Paste key manually** and press Enter on the empty `Public key>` → `No SSH key given.` and `Failed (exit code 1)!`. Press a key. Reopen Setup → Security → SSHD; at the picker press Escape → the terminal ends `Failed (exit code 1)!`.
  * Type `systemctl is-active sshd; sudo ufw status | grep 22; sudo sshd -T | grep -i ^passwordauthentication` again → intended: `inactive`, no rule (a cancel must not leave the machine half-hardened); observed at HEAD: `active`, a `LIMIT` rule and `passwordauthentication yes` — report the state verbatim as the same item-2 defect.
  * Clean up: type `omarchy-remove-security-sshd` (No to removing keys) → `systemctl is-enabled sshd; sudo ufw status | grep -c 22` → `disabled`, `0`, back as it started (if sshd was never enabled, record what the remover prints). Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * A sudo prompt during the first three flag errors is itself a failure — they must exit before touching sudo.
  * The key picker is a gum choose; arrows move, Enter selects, Escape cancels. The Failed prompt closes on any key.
  * `--gh-keys`/`--key=` are HEAD's flags; if the 4.0.2 disk answers `unknown option` for them, record `omarchy-version` and report version skew.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of each flag error with its `exit=` and sshd still disabled afterwards; `Not a valid SSH public key: not-a-key` with `exit=1` and no authorized_keys; the post-state showing `disabled`, `inactive`, no 22 rule and no drop-in; `No SSH key given.` and the Escape exit both ending `Failed (exit code 1)!` with sshd still inactive; `disabled`/`0` after cleanup
  * If unsuccessful
  ** The post-state showing sshd `enabled`/`active`, a `22/tcp LIMIT` rule and `passwordauthentication yes` after the bad key or after the menu cancel (the item-2 defect — report it as such), a flag error that still started sshd, a bad key written to authorized_keys, a sudo prompt during parsing, or a crash
  ** Output of `omarchy-version`
covers: bin/omarchy-setup-security-sshd (require_github_user, option parsing, authorize_key, prompt paths, setup_sshd/open_firewall ordering); default/omarchy/omarchy-menu.jsonc setup.security.sshd; test/shell.d/setup-security-sshd-test.sh; 13-manual-rest.md Observations #17; manual/48:6; manual/35-networking.md:33; 03-INTENDED-BEHAVIOUR.md item 2
merged-from: 13:sshd-setup-rejects-bad-arguments; 42:setup-sshd-menu-cancel-and-bad-input

### sshd-setup-github-keys   [VM-OK] [NET]
description: The "Grab key from GitHub" path of the SSHD wizard fetches `https://github.com/<user>.keys`, authorizes every key idempotently and hardens the server; an unknown GitHub user and an offline fetch are refused with a clear message. A few KB of download.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Omarchy Menu with Super+Space, click Setup → Security → SSHD, password `prime`. At the chooser pick `Grab key from GitHub`. At `GitHub username>` type `this-user-does-not-exist-omarchy-9f3k` and Enter: expect the red `Could not fetch any SSH keys for GitHub user '…'.` and "Failed (exit code 1)!". Press a key. Open a terminal with Super+Enter and type `systemctl is-enabled sshd; systemctl is-active sshd; sudo ufw status | grep 22`.
  ** Intended (reject bad input before anything is installed or opened): `disabled`, `inactive`, no 22 rule. If sshd is enabled/active or `22/tcp LIMIT` is present after the failed fetch, record it as the same early-open defect as `sshd-setup-rejects-bad-arguments-and-bad-key-before-opening-port` (03-INTENDED-BEHAVIOUR item 2), not as a driver error.
  * Repeat Setup → Security → SSHD → `Grab key from GitHub`, type `dhh`, Enter: `Fetching keys from https://github.com/dhh.keys...`, one or more `Authorized key: …` lines, the password-auth disable step and `Perfect!`. Press a key.
  * In the terminal type `wc -l ~/.ssh/authorized_keys`: a count ≥ 1 matching the keys reported.
  * Type `omarchy-setup-security-sshd --gh-keys dhh` (password `prime`): every key now prints `Key already authorized: …` and `wc -l ~/.ssh/authorized_keys` is unchanged.
  * Unhappy path (offline): type `nmcli networking off; omarchy-setup-security-sshd --gh-keys dhh; echo "rc=$?"; nmcli networking on` → the same `Could not fetch` error and `rc=1`.
  ** Run `nmcli networking on` even if the step misbehaves, so the guest is back online.
  * Clean up: type `omarchy-remove-security-sshd`, password `prime`, answer Yes to removing keys. `systemctl is-enabled sshd` → `disabled`. Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The fetch is a few KB; if it hangs more than 30 s the guest network is down — report that rather than the wizard.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the unknown-user refusal with Failed (exit code 1) and the recorded post-state; the fetch and `Authorized key:` lines with the matching `wc -l`; the rerun showing "Key already authorized" with the same line count; the offline `Could not fetch` with `rc=1`; sshd disabled after cleanup
  * If unsuccessful
  ** curl/network errors, duplicated key lines, the bogus user accepted, or `curl -fsSL https://github.com/dhh.keys | head -1` to separate network from wizard failures
covers: bin/omarchy-setup-security-sshd (authorize_keys_from_github, prompt_for_github_user); manual/48:6; manual/51 (SSH access)
merged-from: 13:sshd-setup-github-keys; 42:setup-sshd-github-keys

### fido2-setup-without-device   [VM-PARTIAL] [NET]
description: Without a FIDO2 token the Fido2 wizard installs its PAM module packages and stops cleanly with a plug-it-in message, leaving sudo/polkit PAM and `/etc/fido2` untouched; removal with nothing registered asks for no privileges; registration and the sudo touch test need a real key and are skipped.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `ls -ld /etc/fido2 2>&1; grep -c pam_u2f /etc/pam.d/sudo` → no such directory on a fresh disk, `0`.
  * Open the Omarchy Menu (Super+Space) → Setup → Security → Fido2 with the mouse.
  ** The floating terminal prints `Setting up FIDO2 device for authentication.`, `Installing required packages...` (password `prime`; `libfido2` and `pam-u2f`, ~1 MB download if missing), then the red `No FIDO2 device detected. Please plug it in (you may need to unlock it as well).` and `Failed (exit code 1)! Press any key to close...`. Press a key.
  * Type `grep -c pam_u2f /etc/pam.d/sudo; ls /etc/fido2 2>&1; pacman -Q libfido2 pam-u2f` → `0`, `No such file or directory`, both packages installed.
  * Type `sudo -k; sudo true` → the normal password prompt still works (type `prime`).
  * Type `omarchy-remove-security-fido2; echo "exit=$?"` → with nothing registered it should complete without a sudo password prompt; record the outcome exactly — a pacman dependency error while removing `libfido2` (required by openssh) is a known candidate defect; report it as such, not as a driver failure.
  * Unhappy path (offline install): type `sudo pacman -Rns --noconfirm pam-u2f; nmcli networking off; omarchy-setup-security-fido2; echo "rc=$?"; nmcli networking on` → the package step fails with a pacman download error and a non-zero `rc`, still no PAM change. Run `nmcli networking on` even if the step misbehaves.
  * Close the terminal with Super+W. The package set may differ from the pristine disk afterwards; end with `stop` if the disk must stay pristine.
  ** Skipped here: `pamu2fcfg` registration, `/etc/fido2/fido2`, and the `sudo` touch test — no token in the VM.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * gum/Failed prompts close on any key. The registration path (pamu2fcfg → root-owned stage → atomic publish) needs a real token and cannot be exercised here.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the install lines, the exact no-device message with `Failed (exit code 1)!`, `0` pam_u2f lines and no `/etc/fido2` with both packages installed, the working sudo prompt, the removal outcome, and the offline failure with no PAM change
  * If unsuccessful
  ** PAM modified or `/etc/fido2` created without a device, a package install failure online, removal prompting for sudo with nothing present, or a crash; `cat /etc/pam.d/sudo`
  ** Output of `omarchy-version`
covers: bin/omarchy-setup-security-fido2, bin/omarchy-remove-security-fido2; default/omarchy/omarchy-menu.jsonc (setup.security.fido2); test/shell.d/security-fido2-test.sh, security-fido2-remove-test.sh; manual/37-hardware-authentication.md
merged-from: 24:setup-fido2-no-device; 42:setup-fido2-no-token; 52:fido2-setup-without-device

### dns-preset-switch-no-password-menu-panel-terminal   [VM-OK] [NET]
description: The DNS provider switches between DHCP, Cloudflare and Google from the terminal, the Setup → Network → DNS submenu (✓ on the active one) and the network panel's pills with no password or polkit dialog (the `omarchy-dns` sudoers rule, present since 4.0.2); each switch rewrites NetworkManager and systemd-resolved and the machine keeps resolving names; Custom, lowercase and unknown providers are refused.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter and type `omarchy-dns; resolvectl status | grep -A3 '^Global'; getent hosts omarchy.org` Enter → `DHCP`, the current resolver lines for reference, and an address.
  * Type `sudo -k; sudo omarchy-dns Cloudflare; omarchy-dns` Enter → NO password prompt; `Cloudflare`. Type `cat /etc/NetworkManager/conf.d/20-omarchy-dns.conf; grep ^DNS /etc/systemd/resolved.conf; resolvectl status | grep -i 'DNS Servers'; getent hosts omarchy.org; resolvectl query omarchy.org` → `servers=1.1.1.1,1.0.0.1,2606:4700:4700::1111,2606:4700:4700::1001`; `1.1.1.1#cloudflare-dns.com …`; a line including 1.1.1.1; the name still resolves both ways.
  * Type `sudo -k; sudo -n omarchy-dns Custom; sudo -n omarchy-dns cloudflare; omarchy-dns Bogus; echo $?; omarchy-dns Google Cloudflare; echo $?` Enter → two `a password is required` lines (Custom is not covered; the script accepts lowercase but the sudoers rule does not), then `Usage: omarchy-dns [Cloudflare|Google|DHCP|Custom]` and `1` for `Bogus` and for two arguments.
  * Type `omarchy-dns Custom` Enter (no sudo) → a polkit dialog appears (the script falls back to pkexec because no sudo rule covers Custom); press Escape/Cancel → `omarchy-dns` still `Cloudflare`, unchanged.
  * Press Super+Space → Setup → Network → DNS: DHCP / Cloudflare / Google / Custom are listed, ✓ on Cloudflare. Click **Google** with the mouse: no password dialog and no polkit prompt (a dialog is a failure). Reopen the DNS submenu twice: ✓ is on Google. In the terminal `omarchy-dns; grep ^DNS /etc/systemd/resolved.conf` → `Google`, `8.8.8.8#dns.google`.
  * Press Super+Ctrl+W (network panel). In the "DNS PROVIDER" row the Google pill is filled (active). Hover "DHCP": tooltip "Set DNS to DHCP". Click the DHCP pill → the panel closes itself silently (expected), no polkit dialog. Wait 3 s, press Super+Ctrl+W: the DHCP pill is now the filled one. Press Escape.
  * Type `omarchy-dns; ls /etc/NetworkManager/conf.d/20-omarchy-dns.conf 2>&1; cat /etc/systemd/resolved.conf; getent hosts omarchy.org` Enter → `DHCP`; the conf.d file is gone; `resolved.conf` contains only `DNSOverTLS=no`; an address. Optionally press Super+Shift+Enter and load https://omarchy.org.
  * Close the browser and terminal with Super+W; the desktop is as before with DNS on DHCP.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * `sudo -n -l -l /usr/bin/omarchy-dns Cloudflare | grep authenticate` (or `sudo -n -l -l | grep omarchy-dns`) shows the rule limited to `Cloudflare`, `Google`, `DHCP`; report it either way (it is expected to exist since 4.0.2). A password or polkit dialog on Cloudflare/Google/DHCP is a failure of the sudoers grant.
  * Menu guards paint from the previous open — reopen the DNS submenu twice before asserting the ✓ moved. The panel closes itself after a DNS click; that is expected. `resolvectl` may take a second to reflect a switch; its output is long — pipe to `| sudo tee /dev/ttyS0` if needed.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Terminal screenshots of the prompt-free Cloudflare switch with both config files (IPv4 and IPv6 servers) and resolvectl showing 1.1.1.1, the successful `getent` and `resolvectl query`, the two refusals and the two exact usage errors with `1`, the polkit dialog for the unprivileged `omarchy-dns Custom` cancelled with the provider unchanged; menu screenshots with the ✓ on Cloudflare → Google; panel screenshots with Google active, the DHCP tooltip, then DHCP active; the final `DHCP` with the conf.d file gone, `DNSOverTLS=no` only, and a successful `getent`
  * If unsuccessful
  ** Screenshot of a password/polkit prompt for a stock provider, Custom running unprompted, the pill or ✓ not changing, a floating terminal error, or a failed lookup; `journalctl -b -u NetworkManager -u systemd-resolved | tail -30 | sudo tee /dev/ttyS0` and `resolvectl status | sudo tee /dev/ttyS0` read via get-serial
covers: etc/sudoers.d/omarchy-dns; bin/omarchy-dns (require_root sudo/pkexec); default/omarchy/omarchy-menu.jsonc (setup.network.dns.*); shell/plugins/panels/network/Panel.qml (setDns, DnsProviderPill, dnsProc); PolkitAgent.qml; test/shell.d/dns-sudoers-test.sh; test/shell.d/network-manager-transition-test.sh; manual/35-networking.md (DNS); manual/46:35
merged-from: 41:dns-preset-switch-without-password; 25:dns-switch-cloudflare-google-dhcp; 31:network-dns-pill-change-and-restore; 12:dns-cli-cloudflare-and-back; 13:dns-switch-from-menu-without-password; 51:dns-menu-passwordless

### dns-custom-asks-password-and-rejects-empty   [VM-OK] [NET]
description: The Custom DNS entry (menu row and panel pill) opens a floating terminal that deliberately asks for the sudo password, refuses an empty server list without changing anything, accepts a space-separated list and reports `Custom` in the CLI, menu and panel, and DHCP restores the stock resolver.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `sudo -k; omarchy-dns` → `DHCP`.
  * Open the Omarchy Menu with Super+Space, click Setup → Network → DNS → Custom. The floating "Omarchy" terminal with the logo must prompt `[sudo] password for prime:` (unlike the other three providers). Type `prime`. At `Enter your DNS servers (space-separated, e.g. '192.168.1.1 1.1.1.1'):` press Enter with nothing typed → `Error: No DNS servers provided.` and "Failed (exit code 1)!". Press a key. In your terminal `omarchy-dns` → still `DHCP`.
  * Press Super+Ctrl+W and click the **Custom** DNS pill → the panel closes and the floating terminal opens; after the sudo step type `9.9.9.9 149.112.112.112` and Enter → Done prompt; close it.
  * Type `omarchy-dns; grep servers /etc/NetworkManager/conf.d/20-omarchy-dns.conf; grep ^DNS /etc/systemd/resolved.conf; resolvectl status | grep -A3 '^Global'; getent hosts archlinux.org` → `Custom`; `servers=9.9.9.9,149.112.112.112`; `DNS=9.9.9.9 149.112.112.112`; 9.9.9.9 in the Global block; the name resolves. Press Super+Space → Setup → Network → DNS (reopen twice) → ✓ on Custom; Super+Ctrl+W → the Custom pill is active; Escape.
  * Setup → Network → DNS → Custom again; press Enter on an empty line → `Error: No DNS servers provided.` and the red `● Failed (exit code 1)!` prompt; reopen the DNS submenu: ✓ still on Custom (the failed Custom changed nothing) and `omarchy-dns` is still `Custom` with the same servers.
  * Type `omarchy dns DHCP; omarchy dns` → `DHCP` — back to stock; Setup → Network → DNS shows ✓ on DHCP and Super+Ctrl+W shows the DHCP pill active. Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If passwordless sudo was left on by an earlier test the password prompt will be missing; it must be off for this test.
  * The floating terminal's Failed/Done prompt closes on any key. The ✓ is computed when the submenu opens, so always reopen it (twice) to read the state.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the password prompt inside the Custom terminal and the "No DNS servers provided" failure with `DHCP` unchanged; the prompt from the panel pill; the config files with the two servers, the Global block and the resolved name; ✓ on Custom and the active Custom pill; the second empty-input error with `● Failed (exit code 1)!`, ✓ and servers kept; the return to `DHCP` in CLI, menu and panel
  * If unsuccessful
  ** Custom applying with no servers, no password prompt, the terminal not opening, the active pill or ✓ changing on the empty input, or stale servers after DHCP; `cat /etc/systemd/resolved.conf`
covers: bin/omarchy-dns (Custom branch, require_root/pkexec, normalize_servers, split_dns_servers); etc/sudoers.d/omarchy-dns; default/omarchy/omarchy-menu.jsonc (setup.network.dns.*, setup.network.dns.custom); bin/omarchy-launch-floating-terminal-with-presentation; shell/plugins/panels/network/Panel.qml (setDns Custom branch); manual/35-networking.md (DNS)
merged-from: 13:dns-custom-requires-terminal-and-rejects-empty; 25:dns-custom-servers-and-empty-input; 31:network-dns-custom-rejects-empty-input; 12:dns-menu-check-mark-and-custom

### tmux-dev-layouts-tdl-tsl-tdlm   [VM-OK]
description: `tdl <agent>` builds the three-pane IDE layout (editor left, agent right, terminal bottom) and names the window after the directory, `tsl <n> <cmd>` tiles n panes running one command, and `tdlm <agent>` makes one dev-layout window per subdirectory switchable with Alt+1/2/3; all refuse to run outside tmux or without arguments. `bash` stands in for an AI agent so nothing downloads.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter and type `tdl bash; tsl 2 x; tds` Enter → three refusal lines of the form `You must start tmux to use tdl.` (each naming its own function), nothing else happens.
  * Type `mkdir -p /tmp/multi/a /tmp/multi/b /tmp/multi/c && cd /tmp/multi && t` Enter (tmux starts; status bar `Work`). Type `tdl; tsl 4; tdlm; tds x` Enter → `Usage: tdl <c|cx|codex|other_ai> [<second_ai>]`, `Usage: tsl <pane_count> <command>`, `Usage: tdlm <c|cx|codex|other_ai> [<second_ai>]`, `Usage: tds`.
  * Type `tdl bash` Enter. Within a few seconds the window shows three panes: a large editor pane (Neovim opened on the directory) on the left, a narrower (~30 %) pane on the right running a fresh bash prompt, and a short pane along the bottom with a prompt; the window name in the status bar becomes `multi`.
  ** If Neovim shows a plugin-install window on its first start, wait for it (network) and press `q`. Note whether any `can't find pane` text appears in the bottom pane and which pane has focus — the function ends with `tmux select-pane -t "$opencode_pane"`, a variable only `tds` sets; report it either way.
  * Click the bottom pane and type `tdl bash bash` Enter → a second agent pane appears under the first right-hand pane (the right column is split in two).
  * Click a shell pane and type `tmux kill-window; tmux new-window` Enter, then `tsl 4 'echo swarm; bash'` Enter → the window splits into a 2×2 grid, each pane showing `swarm` above a prompt.
  * Press Ctrl+Space then `k` to kill this window (if the terminal closes, press Super+Alt+Enter and `cd /tmp/multi`). Type `tdlm bash` Enter → the session is renamed `multi` (status bar left) and three windows named `a`, `b`, `c` appear in the status bar, each with the tdl layout. Press Alt+2 and Alt+3 to switch windows; the active window highlight must follow.
  * Type `tmux kill-server` in any shell pane and press Enter; press Ctrl+D if a plain shell remains. The desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * `bash` stands in for an AI agent so no download is needed; the layout is identical. The `ic`/`ix`/`icx` aliases would start real agents — do not use them.
  * tmux has `mouse on`: click a pane to focus it. Neovim can be left with `:qa!` + Enter if you need its pane back. Window numbering starts at 1 (`base-index 1`), so Alt+1 is the first window.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the three "You must start tmux" refusals and the four usage lines; the three-pane `tdl` layout with Neovim on the left and the window named `multi` (plus a note of any `select-pane` error text); the right column split after `tdl bash bash`; the 2×2 `tsl` grid with `swarm` in every pane; the status bar with session `multi` and windows `a b c` while Alt+3 is active
  * If unsuccessful
  ** Screenshot of a wrong pane count, a missing rename, or a tmux error, plus `tmux list-panes` / `tmux list-windows` output
covers: manual/15-terminal.md:17-38; manual/20-shell-functions.md:19-22; default/bash/fns/tmux:3-38,69-124; default/bash/fns/tmux; default/bash/aliases:52-55 (ic, ix, icx); config/tmux/tmux.conf:39-47
merged-from: 11:tmux-dev-layout-tdl; 11:tmux-swarm-and-multi-layouts; 41:tmux-dev-layouts

### fingerprint-setup-hidden-and-refused-without-reader   [VM-PARTIAL]
description: Without a fingerprint reader the Fingerprint row is hidden from both Security submenus and the setup wizard refuses before installing or configuring anything (no sudo, no pacman, PAM untouched); enrolment, verification and the lock-screen PAM stack need a sensor and are skipped.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open the Omarchy Menu (Super+Space) → Setup → Security with the mouse: rows Fido2, SSHD, Passwordless Sudo, Sudoless Docker — **no Fingerprint** row. Screenshot; Escape.
  * Open the Omarchy Menu → Remove → Security: no Fingerprint row either (fprintd is not installed). Escape.
  * Open a terminal with Super+Enter and run `omarchy-hw-fingerprint; echo exit=$?` → `exit=1`.
  * Run `omarchy setup security fingerprint; echo exit=$?` → green `Setting up fingerprint scanner for authentication.` then red `No fingerprint sensor detected.`, `exit=1`, with no `Installing required packages` line, no sudo prompt and no pacman activity.
  * Run `pacman -Q fprintd libfprint-git 2>&1; ls /etc/pam.d/omarchy-lock-fingerprint 2>&1; grep -c pam_fprintd /etc/pam.d/sudo` → both packages `was not found`, `No such file`, `0` (PAM untouched).
  * Close the terminal with Super+W; the desktop is as before.
  ** Skipped here: enrolment, verification, the PAM edits and the lock-screen fingerprint path — they need a reader.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The command needs no sudo on this path; a sudo prompt or a package install is itself the failure.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of both Security submenus without Fingerprint, `exit=1` from the detector, the refusal with `exit=1`, and the untouched package/PAM state
  * If unsuccessful
  ** A Fingerprint row shown, the wizard proceeding to install packages or prompting for sudo, or PAM modified without hardware
covers: manual/37-hardware-authentication.md (Fingerprint authentication); bin/omarchy-setup-security-fingerprint; bin/omarchy-hw-fingerprint; install/user/first-run/setup-fingerprint.hook; default/omarchy/omarchy-menu.jsonc setup.security.fingerprint, remove.security.fingerprint (when)
merged-from: 12:fingerprint-absent-in-vm; 24:setup-fingerprint-hidden-without-reader; 42:setup-fingerprint-absent-in-vm

### pacman-repos-and-signing-key   [VM-OK] [NET]
description: Packages come only from Arch core/extra/multilib plus the Omarchy repo and mirror, signed by the published Omarchy key, and the ISO signature is one `.sig` away — the supply-chain claims of the security chapter.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `pacman -Q omarchy-keyring; pacman-key --list-keys 40DFB630FF42BCFFB047046CF0134EE680CAC571` → a version line and a `pub` block with `pkgs@omarchy.org`.
  * Type `grep -E '^\[' /etc/pacman.conf` → exactly `[options] [core] [extra] [multilib] [omarchy]`.
  * Type `grep -E '^Server' /etc/pacman.conf /etc/pacman.d/mirrorlist; grep '^SigLevel' /etc/pacman.conf` → an `*.omarchy.org` mirror, `pkgs.omarchy.org` for `[omarchy]`, `Required DatabaseOptional`.
  * Type `curl -sIL https://iso.omarchy.org/omarchy-4.0.4.iso.sig | grep -m1 HTTP` → a `200`.
  * Unhappy path: type `pacman-key --list-keys 0000000000000000000000000000000000000000; echo rc=$?` → `error: key "…" could not be looked up remotely` (or `No public key`) and a non-zero rc — only the published key is trusted.
  * Close the terminal with Super+W; nothing was changed.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Only the `.sig` HEAD request needs network (a few hundred bytes).
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the key block with the fingerprint and `pkgs@omarchy.org`, the repo list, mirror servers, SigLevel, the `200` for the `.sig`, and the unknown-key error
  * If unsuccessful
  ** Key missing, extra repositories, a non-omarchy mirror, or a 404
covers: manual/48:8, 48:29-31; default/pacman/*; omarchy-keyring
merged-from: 13:signing-key-and-repo-sources

### zram-swap-active-and-oomd-kills-runaway-app   [VM-OK]
description: Compressed zram swap sized to RAM is active with zstd and priority 100, zswap is off and the reclaim sysctls are tuned for it; and a program that eats all memory is killed by systemd-oomd while the compositor, bar and other windows survive, because only user apps are eligible for the OOM killer.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter and type `swapon --show; zramctl` Enter → `/dev/zram0 … ~4G … PRIO 100` and `zstd`.
  * Type `cat /sys/module/zswap/parameters/enabled; sysctl vm.swappiness vm.page-cluster` Enter → `N`, `150`, `0`.
  * Type `free -h | grep -i swap; ls /swapfile 2>&1; systemctl is-active systemd-oomd` Enter → Swap total ≈ RAM (`3.8G`/`3.9G` for a 4 GB guest), no swapfile, `active`.
  * Press Super+Enter for a second terminal and type `echo SURVIVOR` Enter there.
  * Click the first terminal and type `python3 -c 'import os; b=[]` Enter `while True: b.append(os.urandom(1<<26))'` Enter (the newline between the two python lines matters; type it as shown). Random data is used because zeros would compress into zram and never fill memory.
  * Screenshot every 5 seconds. The guest may be sluggish for up to two minutes; then the first terminal prints `Killed` (or the prompt returns). The second terminal with `SURVIVOR` and the bar are still present; click the second terminal and type `echo alive` Enter — it responds.
  * Type `journalctl -b -o cat | grep -iE 'oom|Killed process' | tail -n 5 | sudo tee /dev/ttyS0` Enter (password `prime`) and read get-serial → a kill of python is logged.
  * Close both terminals with Super+W; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If nothing happens after three minutes press Ctrl+C in the first terminal and report. Move the mouse between screenshots so the 150 s screensaver does not engage.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of swapon/zramctl, the zswap and sysctl values, free/swapfile with oomd active, the `Killed` terminal, the surviving terminal and bar answering `alive`, and the serial lines naming the killed python
  * If unsuccessful
  ** Screenshot of no swap device, zswap `Y`, a wrong priority, the desktop flashing/restarting (compositor killed), a lock-up beyond three minutes, or no kill logged
covers: default/systemd/zram-generator.conf.d/90-omarchy.conf, etc/tmpfiles.d/omarchy-zswap.conf, etc/sysctl.d/99-omarchy-sysctl.conf, default/systemd/user/app.slice.d/10-oomd.conf, etc/systemd/oomd.conf.d/10-omarchy.conf
merged-from: 41:zram-swap-active; 24:oomd-kills-runaway-app-not-session; 41:oomd-app-slice-candidacy

### plugin-registry-rejects-reserved-id-broken-manifest-and-duplicate   [VM-OK]
description: A plugin folder dropped straight into `~/.config/omarchy/plugins/` with a reserved `omarchy.*` id or a broken manifest is rejected by the running shell's own validation on hot-reload and never loads; the plugin CLI refuses unknown ids, a bar placed as a widget, a bad section, an unsafe id and a duplicate manifest id, while a legitimate local repository installs — and the bar is untouched throughout.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and screenshot the bar as a reference. Run `d=~/.config/omarchy/plugins/omarchy.evil; mkdir -p $d; printf '%s\n' 'import QtQuick' 'import qs.Ui' 'BarWidget { moduleName: "omarchy.evil"; implicitWidth: 60; implicitHeight: barSize; Text { anchors.centerIn: parent; text: "EVIL"; color: "red" } }' > $d/W.qml` then `printf '%s\n' '{"schemaVersion":1,"id":"omarchy.evil","name":"Evil","version":"1","kinds":["bar-widget"],"entryPoints":{"barWidget":"W.qml"}}' > $d/manifest.json`.
  * Wait 3 s (the folder watch reloads plugins). Screenshot the bar: no `EVIL` label. Run `omarchy-plugin-enable omarchy.evil; echo "exit=$?"` → `plugin 'omarchy.evil' is not known; run: omarchy-shell shell rescanPlugins`, `exit=1`. Run `journalctl -t omarchy-shell --since -2min --no-pager | grep -i 'omarchy.evil'` → `PluginRegistry: plugin omarchy.evil rejected: id is reserved for first-party Omarchy plugins`.
  * Run `d2=~/.config/omarchy/plugins/t.broken; mkdir -p $d2; printf '%s\n' '{"schemaVersion":1,"id":"t.broken","version":"1","kinds":["bar-widget"],"entryPoints":{"barWidget":"W.qml"}}' > $d2/manifest.json` (no `name`). Wait 3 s. Run `omarchy-plugin-list | grep -c broken` → `0`; `journalctl -t omarchy-shell --since -2min --no-pager | grep -i 't.broken'` → `missing required field 'name'`.
  * CLI negatives, echoing the exit code after each: `omarchy-plugin-enable nope.plugin` → `plugin 'nope.plugin' is not known; run: omarchy-shell shell rescanPlugins`, 1; `omarchy-plugin-enable omarchy.bar --section left` → `'omarchy.bar' is a bar; it replaces the bar in use rather than taking a place in one`, 1; `omarchy-plugin-enable omarchy.clock middle` → `section must be left, center, or right`, 1; `omarchy-plugin-disable nope.plugin` → record the exact output (expected quirk: `Disabled nope.plugin`, exit 0); `omarchy-plugin-remove '../etc' --yes` → `invalid plugin id '../etc'`, 1.
  * Create a valid local plugin repo: `mkdir -p /tmp/acme-demo && cd /tmp/acme-demo && printf '%s\n' '{"schemaVersion":1,"id":"acme.demo","name":"Demo","version":"1.0.0","description":"demo","kinds":["bar-widget"],"entryPoints":{"barWidget":"Widget.qml"},"barWidget":{"displayName":"Demo","description":"demo","category":"Test","allowMultiple":false}}' > manifest.json && printf 'import QtQuick\nItem {}\n' > Widget.qml && git init -q && git add . && git -c user.name=t -c user.email=t@t commit -qm init && cd ~`. Run `omarchy-plugin-add /tmp/acme-demo --yes` → `Added acme.demo into /home/prime/.config/omarchy/plugins/acme.demo` and `Enable it later with: omarchy plugin enable acme.demo`.
  * Duplicate id: `cp -r ~/.config/omarchy/plugins/acme.demo ~/.config/omarchy/plugins/other-folder` then `omarchy-plugin-add /tmp/acme-demo --yes; echo "exit=$?"` → `plugin id 'acme.demo' is already used by …` and a non-zero exit.
  * Clean up: `rm -rf ~/.config/omarchy/plugins/omarchy.evil ~/.config/omarchy/plugins/t.broken ~/.config/omarchy/plugins/acme.demo ~/.config/omarchy/plugins/other-folder /tmp/acme-demo`; wait 3 s; `omarchy-shell shell ping` → `ok`; `ls -a ~/.config/omarchy/plugins/` → no `.add.tmp.*` entries. Screenshot the bar again: identical to the reference. Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The shell reloads plugins on every file save in that folder; the bar may flicker once — that is expected. The menu's Remove Plugin row appears only while a user plugin is installed — you may notice it appear and disappear.
  * If the terminal scrolls, wrap the commands in `{ …; } 2>&1 | sudo tee /dev/ttyS0` and read the serial log.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Terminal/serial output with the `not known` error, both journal rejection lines, every CLI message and exit code as listed (and the recorded disable-unknown quirk), `Added acme.demo into …`, the `plugin id 'acme.demo' is already used by` refusal, `ok` after cleanup and a clean plugins directory; bar screenshots identical before and after with no `EVIL` label
  * If unsuccessful
  ** `omarchy.evil` listed or `EVIL` rendered, the shell dying during reload, the built-in widgets disappearing, a duplicate id accepted, a wrong exit code, or a changed bar
covers: shell/services/PluginRegistry.qml (parseScanOutput reserved-id rejection, validateManifest, localPluginWatcher); shell/shell.qml reloadPlugins, setPluginEnabled/enablePlugin; bin/omarchy-plugin-enable, -disable, -remove, -add; bin/omarchy-git-url-check; test/shell.d/plugin-registry-contract-test.sh, runtime-smoke-test.sh ("installed plugin changes reload without an explicit rescan"), plugin-add-test.sh, plugin-enable-test.sh, menu-test.sh (setup.plugin.add); manual/32-shell-plugins.md
merged-from: 32:plugin-reserved-id-rejected-by-shell; 52:plugin-add-refuses-transport-helpers-and-duplicate-ids; 32:plugin-cli-negative-paths

### plugin-third-party-api-boundary   [VM-OK]
description: A third-party service plugin receives only the scoped plugin shell API: it can reach its own service but not the lock or other first-party services, and cannot summon the menu — proven from inside a plugin by what it writes to a file.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and create the probe plugin: `d=/tmp/probe; mkdir -p $d && cd $d` then `printf '%s\n' '{"schemaVersion":1,"id":"prime.probe","name":"Probe","version":"1","kinds":["service"],"entryPoints":{"service":"Probe.qml"}}' > manifest.json`.
  * Type `printf '%s\n' 'import QtQuick' 'import Quickshell.Io' 'Item { id: root; property var shell: null; Process { id: p } Timer { interval: 2000; running: true; onTriggered: { var s = root.shell; var r = "own=" + (s && s.serviceFor("prime.probe") !== null) + " lock=" + (s && s.serviceFor("omarchy.lock") === null) + " lockfp=" + (s && s.firstPartyServiceFor("omarchy.lock") === null) + " idle=" + (s && s.firstPartyServiceFor("omarchy.idle") === null) + " summon=" + (s && s.summon("omarchy.menu", "{}")) + " hasServices=" + (s && s.services === undefined); p.command = ["bash", "-c", "echo " + r + " > /tmp/probe.txt"]; p.running = true } } }' > Probe.qml` then `git init -q && git add -A && git -c user.name=t -c user.email=t@t commit -qm init && cd ~`.
  * Run `omarchy-plugin-add /tmp/probe --enable --yes` → `Added prime.probe …` and `Enabled prime.probe`.
  * Wait 5 s (one screenshot proving no menu opened). Run `cat /tmp/probe.txt`.
  ** Must read exactly: `own=true lock=true lockfp=true idle=true summon=false hasServices=true` — the plugin sees its own service, gets `null` for the lock (both lookups) and for idle, its summon of the menu is refused, and there is no `services` map on the object it was given.
  * Run `omarchy-plugin-remove prime.probe --yes; rm -f /tmp/probe.txt; rm -rf /tmp/probe` → `Removed prime.probe.`; `omarchy-plugin-list | grep -c probe` → `0`.
  * Close the terminal with Super+W; the desktop is as before.
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
  ** Terminal showing `Added`/`Enabled`, the exact probe line, and the plugin gone from the list afterwards; a screenshot proving no menu opened during the 5 s wait
  * If unsuccessful
  ** The probe line with any unexpected value, a menu opened by the plugin, or a missing probe file with the journal excerpt
covers: shell/services/PluginShellApi.qml, shell/shell.qml (createScopedPluginShell, pluginOwnsTarget, pluginServiceFor, ensureService third-party parenting), shell/services/AuthServiceStore.js, manual/32-shell-plugins.md (trust paragraph), test/shell.d/plugin-auth-boundary-test.sh
merged-from: 32:plugin-third-party-api-boundary

### plocate-index-excludes-snapshots   [VM-OK]
description: The locate index keeps Btrfs subvolumes searchable and excludes snapshots, so `plocate` finds system files but never `/.snapshots` paths, and a miss exits 1.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Enter and type `systemctl cat plocate-updatedb.service --no-pager | grep -E 'ExecStart=/|ConditionACPower'` Enter → `ExecStart=/usr/bin/updatedb --prune-bind-mounts=no --add-prunepaths=/.snapshots` and `ConditionACPower=true`.
  * Type `sudo systemctl start plocate-updatedb.service` Enter (password `prime`); poll `systemctl is-active plocate-updatedb.service` with screenshots until it prints `inactive` (the index run takes a few seconds).
  * Type `plocate omarchy.ttf; echo "snap-hits=$(plocate -c /.snapshots/)"` Enter → `/usr/share/fonts/omarchy/omarchy.ttf` and `snap-hits=0`.
  * Unhappy path: type `plocate no-such-file-zz-123; echo rc=$?` Enter → no output, `rc=1`.
  * Press Ctrl+D; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Poll `is-active` with repeated commands and screenshots rather than a long sleep.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the effective unit lines, the found font path with zero snapshot hits, and the `rc=1` miss
  * If unsuccessful
  ** Screenshot of the stock ExecStart or snapshot paths in results
covers: default/systemd/system/plocate-updatedb.service.d/10-omarchy.conf, etc/systemd/system/plocate-updatedb.service.d/ac-only.conf, docs/file-layout.md
merged-from: 41:plocate-updatedb-config

### install-log-and-phase-timing-clean   [VM-OK]
description: The installer's unified log and phase timing left on the target show every setup leaf completed and every phase `ok`, with the installed package count close to the ISO's expectation — the fastest way to prove the install ran to plan.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `sudo grep -c 'Completed:' /var/log/omarchy-install.log; sudo grep -c 'Failed:' /var/log/omarchy-install.log` (password `prime`) → a count in the dozens, and `0`.
  * Run `sudo grep -E '^=== Omarchy|Omarchy setup:' /var/log/omarchy-install.log` → `=== Omarchy Target Setup Started`, `=== Omarchy Setup Started`, `=== Omarchy Setup Completed`, `Omarchy setup: Xm Ys`.
  * Run `sudo jq -r '.phases[] | "\(.status) \(.name) \(.elapsed|floor)s"' /var/log/omarchy-install-timing.json` → 14 lines all starting `ok`, from `Preparing live environment` to `Creating factory snapshot`.
  * Run `sudo jq '{installed_packages, expected_packages, total: ((.finished_at - .started_at)|floor)}' /var/log/omarchy-install-timing.json` → installed within a few of expected, and the total seconds of the install.
  * Unhappy path: `sudo grep -iE 'error|failed' /var/log/omarchy-install.log | grep -v 'Failed: 0' | head` → report anything found (expected: only harmless lines such as ufw's "not running" in the chroot).
  * Close the terminal with Super+W; nothing was changed.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The log is long; the grep/jq summaries keep output on one screen.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the Completed/Failed counts (`0` failed), the header/footer lines, the 14 `ok` phases and the package counts
  * If unsuccessful
  ** The `Failed:` lines or the phase with `status: failed` and its `error`
covers: install/helpers/logging.sh, bin/omarchy-apply-system, omarchy-iso orchestrator phases.py (state/timing), _run_target_setup_command (log bind), install/config/all.sh, install/hardware/all.sh, install/login/all.sh, install/post-install/all.sh
merged-from: 42:install-log-and-timing-clean

### mise-node-offline-bundle-and-stubs   [VM-OK]
description: The install unpacked the ISO's bundled Node.js into mise without network, pinned `node = "latest"` afterwards, disabled auto-prune, and laid down the agent CLI stubs — `node` works offline on first boot and nothing beyond node was installed through mise.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and run `nmcli networking off; mise ls node; node --version; nmcli networking on` → one installed node version and the matching `v…` from `node` — with the network off.
  ** Run `nmcli networking on` even if a step misbehaves, so the guest is back online.
  * Run `grep -A1 '\[tools\]' ~/.config/mise/config.toml; mise settings get upgrade.auto_prune` → `node = "latest"`, `false`.
  ** `auto_prune=false` is written by a 4.0.4 migration; on a pristine 4.0.2 disk record what is printed and `omarchy-version` instead of failing.
  * Run `ls ~/.local/share/mise/installs/node/; ls /var/lib/omarchy/provisioning/packages/` → the same version as the staged `node-v<ver>-linux-x64.tar.gz`.
  * Run `ls ~/.local/share/mise/shims | tr '\n' ' '` → includes `claude codex gh opencode pi grok hey basecamp cf ori playwright` (stubs; report the full list). Run `ls -d ~/Work/tries` → exists.
  * Unhappy path: `mise ls python 2>&1; echo "rc=$?"` → no installed python via mise (empty) — nothing beyond node was installed at install time.
  * Close the terminal with Super+W; nothing was changed.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Do not run `claude`, `codex` or other stubs: they trigger network installs.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of `mise ls node` and `node --version` while offline, the config pin `latest`, `false` auto_prune (or the recorded 4.0.2 value), matching tarball/installed versions, the shim list, `~/Work/tries`, and the empty python listing
  * If unsuccessful
  ** `mise doctor | head -20` and `cat ~/.config/mise/config.toml`
covers: install/user/mise-work.sh, install/user/mise.sh, omarchy-iso _stage_node_tarball, builder/build-iso.sh (Node download), bin/omarchy-provision-user
merged-from: 42:mise-node-offline-bundle

## Not runnable here

### wifi-qr-band-password-real   [VM-NO]
description: On a machine with Wi-Fi, Setup → Network → QR Code shows a scannable code with a "Show password" control, `omarchy network password <wlan>` prints the PSK and `omarchy network band 5|auto` pins and releases the band; the guest has no wireless adapter, so only the absence path (`wifi-helpers-and-qr-absent-on-wired`) runs here.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Connect to a Wi-Fi network from the network panel (Super+Ctrl+W) — needs a wireless adapter and an access point.
  * Open the Omarchy Menu (Super+Space) → Setup → Network → QR Code: a scannable QR card appears with a "Show password" control; press Escape to close it.
  * Open a terminal (Super+Enter) and type `omarchy network password <wlan>` → the PSK is printed.
  * Type `omarchy network band 5` → the 5 GHz band is pinned and a status line confirms; `omarchy network band auto` releases it.
  ** Unhappy path: `omarchy network band 7; echo $?` → usage and `1`.
  * Close the terminal with Super+W; the network is as found.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Not runnable in this guest: no Wi-Fi radio (user-mode NAT over a wired virtio NIC).
  </Hints>
  </Instructions>
proof: |
  * on success
  ** the QR card with its "Show password" control, the password line, the band status lines, and the usage error
  * If unsuccessful
  ** the error text and `nmcli device status`
covers: manual/35-networking.md (Sharing your Wi-Fi, Pinning the Wi-Fi band), bin/omarchy-network-qr, bin/omarchy-network-password, bin/omarchy-network-band
merged-from: 12:wifi-qr-band-password-real

### onepassword-prompts-need-hardware-acceleration   [VM-NO] [NET]
description: 1Password's SSH-agent/CLI approval prompts require "Use Hardware Acceleration" (plus a reboot) and 1Password launched once; this needs the AUR install, an account, and GPU acceleration the virtio-vga guest lacks.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Install via Super+Space → Install → Service → 1Password (sudo `prime`; medium download); sign in with an account; enable the SSH agent in its settings.
  * With hardware acceleration off, open a terminal (Super+Enter) and type `ssh-add -L` → no approval prompt appears.
  * Turn "Use Hardware Acceleration" on, reboot, launch 1Password once, and repeat `ssh-add -L` → the approval prompt appears.
  ** Unhappy path: with the setting off after the reboot, the prompt must still not appear — record which.
  * Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * virtio-vga without virgl has no GPU acceleration, so the "on" state cannot be reached here; an account is also required.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the setting, the reboot, and the prompt appearing
  * If unsuccessful
  ** No prompt with the setting on after a reboot and 1Password running
covers: manual/45:43-49; bin/omarchy-install-service-1password
merged-from: 13:onepassword-prompts-need-hardware-acceleration

### fingerprint-and-fido2-enrol-real   [VM-NO]
description: Enrolling a fingerprint or registering a FIDO2 key, then using them for sudo, polkit and the lock screen, needs the physical sensor or key; the guest has neither, so only the absence paths (`fingerprint-setup-hidden-and-refused-without-reader`, `fido2-setup-without-device`) run here.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * With a fingerprint reader attached, open the Omarchy Menu (Super+Space) → Setup → Security → Fingerprint: enrol a finger and verify it when asked; the wizard ends `Perfect! … authentication is now configured.`
  * Press Super+Ctrl+L and unlock with the enrolled finger — no password typed.
  * With a FIDO2 key plugged in, open Setup → Security → Fido2: touch the key when asked; the wizard ends `Perfect! … authentication is now configured.`
  * Open a terminal (Super+Enter) and type `sudo -k; sudo true` → the prompt asks for the key; touch it → success without a password.
  ** Unhappy path: repeat `sudo -k; sudo true` and press Ctrl+C at the key prompt → sudo falls back to the password prompt.
  * Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Not runnable in this guest: no fingerprint reader and no FIDO2 token.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** `Perfect! … authentication is now configured.` from both wizards and a sudo/lock authentication without a password
  * If unsuccessful
  ** `Enrollment failed` / `Verification failed` output
covers: manual/37-hardware-authentication.md, bin/omarchy-setup-security-fingerprint, bin/omarchy-setup-security-fido2
merged-from: 12:fingerprint-and-fido2-enrol-real

### speaker-tuning-on-matching-laptop   [VM-NO]
description: On a laptop with a shipped tuning (e.g. Dell XPS 14), `omarchy audio tuning on` installs the filter-chain host, the tuning sink appears and becomes the default, the physical sink is hidden from the output list, volume keys move the physical sink, and `off` restores raw speakers; needs matching DMI hardware, a real sink and lsp-plugins-lv2 — the guest has none, so only `audio-tuning-no-matching-hardware` runs here.
instruction: |
  <Instructions>
  From the desktop please do the following (on a laptop with a tuning under default/audio/tunings):

  <ActionList>
  * Open a terminal (Super+Enter) and type `omarchy-audio-tuning status` → `Matches:` names the tuning. Type `omarchy-audio-tuning on` → `Installed speaker tuning: …` then `Speakers now play through the tuning.`
  * Type `pactl get-default-sink` → `omarchy_speaker_tuning`; `omarchy-audio-sink-availability` lists the physical speaker sink with `0`; `omarchy-audio-output-sink` → the physical sink; press Super+Ctrl+A → one speaker entry in the output switcher.
  * Press the volume keys (or `wtype -k XF86AudioRaiseVolume`) → the OSD moves and `pactl get-sink-volume <physical>` follows while the tuning sink stays 100 %.
  * Type `omarchy-audio-tuning on` again → `Speaker tuning already current`.
  * Type `omarchy-audio-tuning off` → `Speaker tuning removed.`; the default sink is back on the speakers.
  * Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Not runnable in this guest: no audio device and no matching DMI SKU.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Terminal screendumps of each message, the sink lists, the OSD and pactl volumes agreeing on the physical sink
  * If unsuccessful
  ** `systemctl --user status omarchy-speaker-tuning.service` and `pactl list sinks short`
covers: bin/omarchy-audio-tuning, bin/omarchy-audio-output-sink, bin/omarchy-audio-sink-availability, bin/omarchy-audio-output-switch, bin/omarchy-audio-output-volume, docs/audio-tuning.md
merged-from: 25:speaker-tuning-on-matching-laptop

## Moved to other domains
- 25:shell-ipc-ping-and-errors → D — `omarchy-shell` IPC wrapper contracts for the quickshell desktop; joins D's `61:shell-ipc-and-bar-move`.
- 32:shell-ipc-errors-when-shell-down → D — same IPC-wrapper story (unknown target/method, `-q`, shell down).
- 52:shell-ipc-contracts-from-terminal → D — same IPC story, driving OSD, panels and the menu over IPC.
- 50:shell-plugins-loaded → D — `listPlugins`/`summon` contract of the quickshell plugin set (bar widgets, panels, overlays).
- 32:media-service-absent-player → D — media service and bar widget absence path; joins D's `30:osd-media-keys-without-hardware`.
- 12:plugin-add-local-git-repo-lifecycle → F1 — plugin add/enable/update/remove machinery from a local repo; same story as F1's `32:plugin-add-local-enable-disable-remove`.
- 25:plugin-add-from-public-git-url → F1 — network add path of the same plugin lifecycle.
- 32:plugin-add-from-git-url → F1 — network add path of the same plugin lifecycle (its URL-guard negatives are covered here by `git-url-check-refuses-hostile-urls`).
- 11:docker-db-redis → F1 — Install → Development → Docker DB; same story as F1's `23:docker-db-redis-install-and-cancel` (including the `main_menu: command not found` Escape defect).
- 13:faq-chromium-account-credentials → F1 — Install → Service → Chromium Account install and idempotency marker; F1 holds the sibling chromium-account block.
- 41:terminal-alternatives-kitty-config → F1 — Install → Terminal → Kitty and switching the default terminal back; same story as F1's `11:install-terminal-kitty-and-switch-default` / `23:install-terminal-kitty-and-reject-unknown`.
- 11:pdf-open-and-annotate-xournalpp → F2 — Evince/Xournal++ open-annotate-export workflow is an application-in-use story (the MIME default alone is not enough of a story to keep here).
- 51:kitty-remote-control-repair → G1 — runs migration `1788745941.sh` and checks its edits; joins G1's `43:post-update-kitty-config-refreshed`.

Routing-pass note (entries above unchanged for accounting): B simultaneously moved its own copies of four of these stories to H (`10:nightlight-toggle-hotkey-status`, `22:launch-shell-supervisor-recovers`, `25:restart-shell-from-menu`), so H now holds `nightlight-toggle-hotkey-menu-and-status`, `shell-supervisor-relaunches-after-crash` and `shell-restart-from-menu-and-lock-guard`. When the orchestrator resolves the four blocks above that went to B (`32:nightlight-toggle-service`, `32:shell-supervisor-relaunches-after-crash`, `51:shell-supervisor-relaunches-and-gives-up`, `32:restart-shell-keeps-desktop-working`), they fold into those three H tests (the give-up-after-six loop and the wallpaper/notification/lock checks after a restart are the unique steps to add).

## Dropped

(none)
