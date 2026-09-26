# E — Theme and style — final tests

This domain is everything a user does to make Omarchy look the way they want: switching themes
(menu, hotkey, cancel, concurrent), cycling all 22 stock themes, light/dark GTK, user themes and
overlays, theme install from git (offline local repo drops code files; community repo via the menu
over the network; hostile URLs refused), theme remove (the active user theme is unguarded — pinned),
templates and live retints (terminal, tmux, btop, Neovim, Hyprland border, lock-screen section,
Chromium policy, Obsidian, absent-app hooks), backgrounds (picker, next, user folder, video, bad
path, thumbnail cache, desktop double-click), fonts (set, list, install Nerd Font, fontconfig and
icon glyphs, kitty.conf edits), branding (About text/image/reset), Plymouth (preview, list, bad
input, wrong sudo password), the `omarchy-refresh-*` restores, and bar position/transparency from
Style → Menu Bar. 105 source blocks → 51 runnable tests plus 1 not runnable; 6 blocks moved to other
domains (keyboard-only menu walk → B; rsync watchers, man/bat and the privileged `apply-*` guards →
H; notification icon slot → D; WhatsApp Slim → F2); 0 dropped. Notable merges: six theme-switch
blocks became `theme-switch-menu-and-hotkey`; five drop-code-files blocks became one offline
`theme-install-git-url-drops-code-files` (a local `git init` repo stands in for a stranger's); four
background-picker blocks became `background-picker-select-and-cancel`; four refresh-config blocks
(menu Hyprland restore, CLI per-file, idempotence, refusals and the documented `..` escape) became
`refresh-config-hyprland-restores-with-backup`; three font-install and three font-set blocks became
one NET test and one offline test each. Where reviewers disagreed (stock font is JetBrainsMono, the
background switcher is not launched filterable, foot needs a new window for a font change) the
tests assert 01-FACTS. `03-INTENDED-BEHAVIOUR.md` verdicts applied: #8 (active-theme removal is a
DEFECT/regression — the proof asserts the refusal and records the HEAD removal), #27 (the `..` refresh
path must be rejected — proof asserts `exit=1`, records the HEAD escape), #21 (group refresh with
`.bak.<epoch>`, CODE-INTENDED), #18 (22 themes, doc gap) and #23 (`omarchy pkg add owe` → `error:
target not found`, docs defect). Routing pass: 18 blocks arrived from G2, A1, I and C (105 + 18 =
123 accounted); 11 folded into existing tests (four theme-install URL refusals into the hostile-URL
story, two `bg set` blocks, the font CLI, refresh-config CLI guards, the Hermes hook, the Unlock
refusals, the video/lock block) and 7 formed three new tests: `theme-switch-cli-list-renders-and-rejects`,
`plymouth-set-by-theme-reboot-and-reset` (SLOW) and `restart-helpers-quiet-when-target-absent`. Final:
54 runnable tests + 1 not runnable.

## Tests

### theme-switch-menu-and-hotkey   [VM-OK]
description: Switching the theme from Omarchy Menu → Style → Theme with the mouse and from the Super+Shift+Ctrl+Space picker (typing filters) re-skins the whole desktop, Escape in the theme, background or unlock picker leaves everything untouched, and switching back restores the desktop.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy-theme-current; omarchy-theme-bg-current`. Note both names (fresh disk: `Tokyo Night`; neither may be `Unknown`). Leave the terminal open and note its navy background.
  * Press Super+Space, click `Style`, then click `Theme` with the mouse. Within 30 s a carousel of labelled theme previews opens with `Tokyo Night` highlighted in the centre (thumbnails are generated on first open).
  ** Unhappy path first: press Right twice (the centre preview and its label change), then Escape. Within 15 s the overlay closes; wallpaper and colours are unchanged.
  * Repeat the menu path and click the `Gruvbox` tile with the mouse. Do not use the keyboard for this selection.
  ** Within ~5 s (allow up to 15 s — applying a theme runs several scripts) the wallpaper, bar and menu turn warm brown/olive and the open terminal's background turns dark grey without restarting anything. Type `omarchy-theme-current` → `Gruvbox`.
  * Press Super+Shift+Ctrl+Space. The theme picker opens directly, without the main menu. Press Escape: the desktop is unchanged.
  * Press Super+Shift+Ctrl+Space again and type `nor`: the query appears under the label and the carousel narrows to `Nord`. Press Enter. The desktop switches to Nord (blue-grey wallpaper and bar).
  * Press Super+Space → `Style` → `Background`: move the highlight to a different thumbnail with the arrow keys and press Escape. Then `Style` → `Unlock`: move to a different tile (`default` is one of them) and press Escape.
  ** No floating terminal and no password prompt may appear; the wallpaper and colours stay Nord.
  * Press Super+Shift+Ctrl+Space, type `tokyo`, press Enter. The desktop is Tokyo Night again and `omarchy-theme-current` prints the original name.
  ** The wallpaper may be a *different* Tokyo Night image than at the start — expected (a switch lands on the theme's next background).
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Super+Shift+Ctrl+Space is `<M-C-S-SPACE>`. Escape while a filter is typed only clears the filter (two-stage): press it again to close. If typing does not filter, move the highlight with the arrow keys and report that filtering did not work.
  * Left/Right wrap around the carousel; scroll with the mouse wheel if a tile is off-screen. ./client-with-image returns a screenshot after each action; double-check the mouse position before clicking a tile.
  * Theme switches animate for about a second; take a screenshot every 3–5 s for up to 15 s before judging.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the picker with Tokyo Night highlighted; the unchanged desktop after each Escape (theme, background, unlock); the Gruvbox desktop with the retinted terminal and `Gruvbox` in the terminal; the carousel narrowed to Nord and the Nord desktop; the restored navy desktop with the original name printed
  ** The mouse, not the keyboard, made both menu selections
  * If unsuccessful
  ** Screenshot of a half-themed desktop (bar and terminal disagreeing), of whatever Escape triggered (theme change, floating terminal, sudo prompt), or of the picker not opening after 30 s; the terminal output of `omarchy-theme-current`
covers: manual/06:3-5; manual/07:174; default/hypr/bindings/utilities.lua:18 (SUPER+SHIFT+CTRL+SPACE); omarchy-menu.jsonc style.theme/style.background/style.unlock (`[[ -n $x ]] &&` guards); bin/omarchy-theme-switcher (--filterable); bin/omarchy-theme-set; bin/omarchy-theme-current; bin/omarchy-theme-bg-switcher; bin/omarchy-plymouth-switcher; bin/omarchy-menu-images; shell/plugins/image-picker/ImagePicker.qml (filterable, labels, selectAdjacent, applySelected); test/shell.d/background-test.sh; test/acceptance.d/shell-surfaces-test.sh:58-72; test/acceptance.d/system-test.sh:51-55
merged-from: 21:theme-switch-menu; 21:theme-switch-hotkey; 10:theme-picker-hotkey-apply-and-cancel; 31:menu-theme-switch-image-picker; 21:theme-picker-cancel-keeps-theme; 50:style-selectors-preview-and-cancel

### theme-concurrent-switch-serialises   [VM-OK]
description: Three theme switches fired at once end in one consistent theme — name, colours and wallpaper agree — and the next switch still works.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy-theme-set nord & omarchy-theme-set gruvbox & omarchy-theme-set kanagawa & wait; sleep 5; omarchy-theme-current`.
  * The printed name must match what is on screen: `Nord` ↔ blue-grey, `Gruvbox` ↔ brown/olive, `Kanagawa` ↔ ink-dark with an off-white border. Which one wins is not defined.
  * Type `ls ~/.local/state/omarchy/current/` → `background theme theme.name` and no `next-theme` left behind.
  * Type `omarchy-theme-set tokyo-night`; it applies normally (the lock was released).
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Take the desktop screenshot in the same moment as reading the printed name.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Terminal name matching the desktop screenshot; the `ls` without `next-theme`; successful restore to Tokyo Night
  * If unsuccessful
  ** Mismatched name/desktop or a lingering `next-theme`
covers: bin/omarchy-theme-set (flock, atomic swap)
merged-from: 21:theme-concurrent-switch-serialises

### theme-switch-cli-list-renders-and-rejects   [VM-OK]
description: `omarchy theme list/current/set` name all 22 themes and switch by display name from a terminal (case- and space-insensitive), a switch regenerates every shipped template into the current-theme state without errors for the many target apps that are not installed, and unknown, empty or path-like names are refused without touching the desktop.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy theme current; cat ~/.local/state/omarchy/current/theme.name` → `Tokyo Night` and `tokyo-night` on a fresh disk. Screenshot the desktop for comparison.
  * Type `omarchy theme list | sudo tee /dev/ttyS0` (password `prime`). Read the serial: 22 Title Case names (Catppuccin … White) including `Tokyo Night`, `Gruvbox`, `Catppuccin Latte`, `Last Horizon`, `Lupine`, `Solitude`.
  * Type `omarchy theme set nord 2>&1 | tee /tmp/theme.out; echo "exit=$?"`. Within 5 s the bar, terminal background and wallpaper change to Nord's blue-grey palette; `exit=0`; `cat ~/.local/state/omarchy/current/theme.name` → `nord`.
  ** `/tmp/theme.out` must contain no `command not found` or `No such file` lines for obsidian, vscode, hermes, pi, claude, t3code or keyboard — those targets are absent here and must fail silently.
  * Type `ls ~/.local/state/omarchy/current/theme/ | sudo tee /dev/ttyS0` → the listing includes alacritty.toml, btop.theme, chromium.theme, claude.json, foot.ini, ghostty.conf, gum_env.lua, helix.toml, hermes.yaml, hyprland.lua, hyprland-preview-share-picker.css, keyboard.rgb, kitty.conf, neovim.lua, obsidian.css, pi.json, shell.toml, t3code.json, vscode-theme.json, colors.toml and backgrounds. Type `grep -l '{{' ~/.local/state/omarchy/current/theme/*` → prints nothing (no unrendered placeholders).
  * Press Super+Shift+Ctrl+Space: the picker opens on `Nord` as current. Press Escape.
  * Type `omarchy theme set Catppuccin` → the desktop switches to Catppuccin (purple/blue); `omarchy theme current` → `Catppuccin`.
  * Unhappy paths: type `omarchy-theme-set; echo "exit=$?"` → `Usage: omarchy-theme-set <theme-name>`, `exit=1`; `omarchy-theme-set not-a-theme; echo "exit=$?"` → `Theme 'not-a-theme' does not exist`, `exit=1`, the desktop stays Catppuccin; `omarchy-theme-set ../gruvbox; echo "exit=$?"` → `Invalid theme name: ../gruvbox`, `exit=1`.
  * Type `omarchy theme set "Tokyo Night"` (quoted display name). Within 5 s the desktop matches the first screenshot (the wallpaper may differ — a switch lands on the theme's next background); `rm /tmp/theme.out`; close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The retint runs in parallel; give it up to 5 s before judging colours. The `ls` may wrap — the serial copy is authoritative.
  * Theme names are case- and space-insensitive on the CLI (`Catppuccin`, `"Tokyo Night"`, `nord` all work). Reviewer 61 wrote `omarchy theme current` → `tokyo-night`; reviewers 10/21 say it prints the display name `Tokyo Night` — the slug is in `theme.name`. Record what it prints.
  * 22 themes is the shipped count; the manual's gallery omits Last Horizon, Lupine and Solitude (03-INTENDED-BEHAVIOUR #18, doc gap only).
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Serial with the 22-entry list; before/after screenshots (stock Tokyo Night, Nord palette on bar + terminal + wallpaper with `exit=0`, Catppuccin, Tokyo Night again); the directory listing with all template outputs and the empty grep; the picker on Nord; the three refusal messages with `exit=1`
  * If unsuccessful
  ** Screenshot of `/tmp/theme.out` (any `command not found` / `No such file` line) and of the theme directory listing; the failing command's output; any error toast
covers: bin/omarchy-theme-set (argument guards, name normalisation, post_theme_commands); bin/omarchy-theme-list; bin/omarchy-theme-current; bin/omarchy; default/themed/*.tpl; docs/theming.md §Theme activation flow, §Template placeholders; default/agents/skills/omarchy/theming.md §Theme Commands; manual/06:3; manual/14:22-23; omarchy-menu.jsonc:104
merged-from: 61:theme-switch-cli-renders-everything; 21:theme-switch-cli-rejects-bad-names; 10:theme-set-menu-and-cli-rejects-unknown

### theme-cycle-all-22   [VM-OK] [SLOW]
description: Every shipped theme applies cleanly from a terminal loop — a different wallpaper and palette each time, no broken shell, no unrendered placeholder left in any generated file.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `sudo -v` (password `prime`) so the loop can write to the serial console.
  * Type this loop on one line and press Enter:
  ** `for t in $(ls /usr/share/omarchy/themes); do omarchy-theme-set "$t" && sleep 4 && echo "== $t: mode=$(omarchy-theme-color mode) leftovers=$(grep -Il '{{' ~/.local/state/omarchy/current/theme/* 2>/dev/null | wc -l)"; done 2>&1 | sudo tee /dev/ttyS0`
  * Take a screenshot roughly every 5 seconds while it runs (22 themes ≈ 2–4 minutes) so every theme's desktop is captured.
  ** The bar must stay visible throughout; if the screen goes black or the bar disappears, stop and report which theme.
  * When the prompt returns, read the serial (`get-serial`): 22 `== <theme>:` lines, `leftovers=0` on every line, `mode=light` on exactly catppuccin-latte, flexoki-light, lupine, rose-pine and white, `mode=dark` on the other 17.
  * Type `omarchy-theme-set tokyo-night`; the desktop is back to Tokyo Night (its wallpaper may differ from the start — expected).
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Never sleep more than 5 s between screenshots; poll with get-image instead of waiting for the loop.
  * The `leftovers` count is the one fact the screen cannot show: a raw `{{ … }}` left in a generated file.
  * There are 22 stock themes, including `last-horizon`, `lupine` and `solitude`, which the manual's preview gallery omits (03-INTENDED-BEHAVIOUR #18: CODE-INTENDED, pure doc gap).
  </Hints>
  </Instructions>
proof: |
  * on success
  ** 22 desktop screenshots with visibly different wallpapers/palettes; serial log with 22 lines, all `leftovers=0`, 5 light / 17 dark
  * If unsuccessful
  ** The serial line that disagrees and the screenshot of the broken desktop
covers: bin/omarchy-theme-set, bin/omarchy-theme-set-templates, bin/omarchy-theme-color (mode), themes/*, default/themed/*.tpl
merged-from: 21:theme-cycle-all-22

### theme-reset-current-advances-background   [VM-OK]
description: Re-applying the active theme moves to its next wallpaper, and switching to another theme starts on that theme's first wallpaper — the rule every other theme test has to expect.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy-theme-bg-current` (fresh disk: `Winding Road`).
  * Type `omarchy-theme-set tokyo-night` (the theme already active). The wallpaper changes; `omarchy-theme-bg-current` → `Quattro`.
  * Type it again → `Swirl Buck`.
  * Type `omarchy-theme-set nord`; `omarchy-theme-bg-current` → `Black Moon` (Nord's first).
  * Type `omarchy-theme-set tokyo-night`; `omarchy-theme-bg-current` → `Winding Road` (back to the first, since the Nord filename does not exist in Tokyo Night). The desktop is as found.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If the starting name is not `Winding Road`, record it; the sequence must still advance one image at a time.
  * Only `omarchy-theme-refresh` re-renders without moving the wallpaper (see `theme-refresh-repairs-rendered-file`).
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Five wallpaper screenshots with the matching names in the terminal
  * If unsuccessful
  ** `ls ~/.local/state/omarchy/current/theme/backgrounds/` and the observed sequence
covers: bin/omarchy-theme-set (choose_theme_background / choose_staged_theme_background), bin/omarchy-theme-bg-current
merged-from: 21:theme-reset-current-advances-background

### theme-light-dark-gtk-settings   [VM-OK]
description: A light theme flips GTK apps (Files) to light chrome and the theme's icon colour, a dark theme flips them back, and a user theme's `mode = "light"|"dark"` line in colors.toml drives the same switch.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy-theme-set tokyo-night` (the install-time apply never wrote the GTK settings, so normalise first), then `gsettings get org.gnome.desktop.interface color-scheme` → `'prefer-dark'`.
  * Type `nautilus &`. The Files window opens with dark chrome and magenta folder icons (oversized under GDK_SCALE=2 — expected).
  * Type `omarchy-theme-set catppuccin-latte`. Within 5 s the wallpaper is pale and Files turns light with blue folder icons; `gsettings get org.gnome.desktop.interface color-scheme` → `'prefer-light'`; `gsettings get org.gnome.desktop.interface gtk-theme` → `'Adwaita'`.
  * Type `omarchy-theme-set gruvbox`: Files is dark again, folders olive. Type `omarchy-theme-set white`: Files is light once more with grey folders.
  * User theme mode flag: type `cp -r /usr/share/omarchy/themes/catppuccin-latte ~/.config/omarchy/themes/probe-light && grep -n '^mode' ~/.config/omarchy/themes/probe-light/colors.toml` → `mode = "light"`; then `sed -i 's/^mode = "light"/mode = "dark"/' ~/.config/omarchy/themes/probe-light/colors.toml && omarchy-theme-set probe-light`.
  ** color-scheme is back to `'prefer-dark'` and Files is dark although the palette is Latte's.
  * Restore: type `omarchy-theme-set tokyo-night && omarchy theme remove probe-light` → `Removed probe-light`; close Files (Ctrl+Q or Super+W on it).
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Files follows the setting live; if it does not, close and reopen it and note that in the report.
  * Light/dark is `mode = …` in colors.toml; the 5 light stock themes are catppuccin-latte, flexoki-light, lupine, rose-pine, white.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Files dark with magenta icons; light with blue icons and `'prefer-light'`/`'Adwaita'`; dark with olive icons; light with grey icons; dark again under the edited user theme with `'prefer-dark'`; restored Tokyo Night
  * If unsuccessful
  ** The Files screenshot that did not flip and `gsettings get org.gnome.desktop.interface gtk-theme`
covers: bin/omarchy-theme-set-gnome, themes/*/icons.theme, themes/*/colors.toml mode, themes/catppuccin-latte/colors.toml, bin/omarchy-theme-color, manual/43-making-your-own-theme.md (Light mode)
merged-from: 21:theme-light-dark-gnome-settings; 12:custom-light-theme-switches-gtk

### theme-user-theme-directory-applies   [VM-OK]
description: A theme the user writes or copies into `~/.config/omarchy/themes/<name>/` shows up in the picker and the Unlock list and applies (title-case names are normalised); without backgrounds it warns instead of failing, and unknown or path-like names are refused.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `mkdir -p ~/.config/omarchy/themes/mytheme && sed 's/#282828/#102030/; s/#7daea3/#ff8800/' /usr/share/omarchy/themes/gruvbox/colors.toml > ~/.config/omarchy/themes/mytheme/colors.toml`.
  * Type `omarchy-theme-set mytheme`.
  ** A toast `No background was found for theme` appears for ~2 s; the wallpaper stays, but the bar and menu recolour to navy with an orange accent.
  * Press Super+Shift+Ctrl+Space: a `Mytheme` tile is in the carousel (a blank or generic thumbnail is fine, the label must be there). Press Escape.
  * Type `mkdir -p ~/.config/omarchy/themes/mytheme/backgrounds && cp /usr/share/omarchy/themes/nord/backgrounds/1-city-view.webp ~/.config/omarchy/themes/mytheme/backgrounds/ && omarchy-theme-set mytheme`. The wallpaper becomes the Nord city view with no toast.
  * Copy a whole shipped theme: type `cp -r /usr/share/omarchy/themes/tokyo-night ~/.config/omarchy/themes/probe-red && sed -i 's/^accent = .*/accent = "#ff2020"/; s/^background = .*/background = "#2a0000"/; s/^foreground = .*/foreground = "#ffd0d0"/' ~/.config/omarchy/themes/probe-red/colors.toml && omarchy theme set "Probe Red"` (title case with a space applies too — names are normalised).
  ** The bar, menu and terminal recolour to a dark red background with red accents and one of the copied Tokyo Night wallpapers. Press Super+Space and screenshot the red-accented menu; then `Style` → `Unlock` includes a `probe-red` preview (the copy carries preview-unlock.png). Escape.
  * Unhappy path: type `omarchy theme set nonexistent; echo "exit=$?"` → `Theme 'nonexistent' does not exist`, `exit=1`, desktop unchanged; `omarchy theme set '../etc'; echo "exit=$?"` → `Invalid theme name: ../etc`, `exit=1`.
  * Restore: type `omarchy-theme-set tokyo-night && omarchy theme remove probe-red && rm -rf ~/.config/omarchy/themes/mytheme` → `Removed probe-red` plus a `Theme removed` toast; Super+Shift+Ctrl+Space no longer lists Probe Red or Mytheme. Escape.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Screenshot right after the first `omarchy-theme-set mytheme`; the toast is short.
  * Theme switches animate for about a second; Neovim/btop/browser retints run in the background — the bar and menu are the visible proof.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The `No background was found for theme` toast with the navy/orange bar; the `Mytheme` tile; the city-view wallpaper; the red desktop with the red-accented menu and the Unlock list showing probe-red; the two refusals with `exit=1`; restored Tokyo Night with both themes gone from the picker
  * If unsuccessful
  ** Terminal output of the failing `omarchy-theme-set`, `ls ~/.local/state/omarchy/current/theme/`, `./client get-serial`
covers: bin/omarchy-theme-set (user themes, set_theme_background failure path, name normalisation), bin/omarchy-theme-list, bin/omarchy-theme-switcher (preview fallback), bin/omarchy-theme-remove, bin/omarchy-plymouth-list, default/hypr/bindings/utilities.lua:18, test/shell.d/user-theme-test.sh, docs/theming.md, manual/43-making-your-own-theme.md (intro, Unlock image), manual/06 (theme picker)
merged-from: 21:theme-user-theme-directory; 12:custom-theme-from-copy

### theme-user-overlay-on-stock-theme   [VM-OK]
description: A user folder named like a stock theme overlays only the files it contains — the user's colours win while the stock wallpapers stay — user images in `~/.config/omarchy/backgrounds/<theme>/` join that theme's rotation, and removing the overlay restores the stock theme.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `mkdir -p ~/.config/omarchy/themes/gruvbox && sed 's/#7daea3/#ff0000/' /usr/share/omarchy/themes/gruvbox/colors.toml > ~/.config/omarchy/themes/gruvbox/colors.toml`.
  * Type `omarchy-theme-set gruvbox`. Within 5 s the wallpaper is a stock Gruvbox image but the focused window border, the bar's active-workspace accent and the menu highlight are pure red.
  * Type `grep -c ff0000 ~/.local/state/omarchy/current/theme/alacritty.toml` → 1 or more (the overlay reached a rendered template); `ls ~/.local/state/omarchy/current/theme/backgrounds | head -3` → Gruvbox's stock wallpapers (files you did not overlay come from the stock theme).
  * Type `mkdir -p ~/.config/omarchy/backgrounds/gruvbox && cp /usr/share/omarchy/themes/white/backgrounds/1-white.webp ~/.config/omarchy/backgrounds/gruvbox/zz-user.webp`, then `omarchy-theme-bg-next`, repeating up to 7 times, until the wallpaper turns white.
  ** The user image is part of the cycle; its position depends on sort order.
  * Round trip: type `rm -rf ~/.config/omarchy/themes/gruvbox ~/.config/omarchy/backgrounds/gruvbox && omarchy-theme-set gruvbox` → the focused border is Gruvbox's normal teal again.
  * Type `omarchy-theme-set tokyo-night` and close the terminal with Super+W; the desktop is stock.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Press Super+Space between steps to see the red accent on the menu highlight; open a second terminal with Super+Enter if you need two borders to compare.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Gruvbox wallpaper with a red border/accent and the grep count; the white wallpaper reached through bg-next; teal accent after the overlay is removed; restored Tokyo Night
  * If unsuccessful
  ** `ls -la ~/.config/omarchy/themes/`, `ls ~/.local/state/omarchy/current/theme/backgrounds/`, the theme-set stderr and the last wallpaper screenshot
covers: bin/omarchy-theme-set (overlay copy order), bin/omarchy-theme-bg-next (user backgrounds), docs/theming.md §Theme activation flow (overlay step 2), default/agents/skills/omarchy/theming.md §Customizing a Stock Theme, default/agents/skills/omarchy/SKILL.md §Example Requests
merged-from: 21:theme-user-overlay-on-stock-theme; 61:theme-user-overlay-wins

### theme-legacy-alacritty-only-theme   [VM-OK]
description: A user theme in the old format (only an `alacritty.toml`) still gets a palette and applies; an incomplete one warns and leaves the desktop usable.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type on one line: `mkdir -p ~/.config/omarchy/themes/legacy && printf '[colors.primary]\nbackground = "#301010"\nforeground = "#f0e0e0"\n[colors.normal]\nblack = "#301010"\nred = "#ff5555"\ngreen = "#50fa7b"\nyellow = "#f1fa8c"\nblue = "#6272a4"\nmagenta = "#ff79c6"\ncyan = "#8be9fd"\nwhite = "#f0e0e0"\n' > ~/.config/omarchy/themes/legacy/alacritty.toml`
  * Type `omarchy-theme-set legacy`. The bar and the terminal turn dark maroon (a toast about no background is expected).
  * Type `mkdir -p ~/.config/omarchy/themes/broken && printf '[colors.normal]\nblack = "#000000"\n' > ~/.config/omarchy/themes/broken/alacritty.toml && omarchy-theme-set broken; echo "exit=$?"`.
  ** Expected: `Warning: Cannot extract all normal colors from …/alacritty.toml, skipping generation`; the command still returns `exit=0`.
  * Press Super+Space: the menu still opens and the bar is still visible (the desktop survived a palette-less theme). Escape.
  * Type `omarchy-theme-set tokyo-night && rm -rf ~/.config/omarchy/themes/legacy ~/.config/omarchy/themes/broken`; the desktop is fully Tokyo Night.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If the bar disappears or the shell crashes after `broken`, that is the finding — capture it and recover with the last step from the terminal.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Maroon bar/terminal for `legacy`; the Warning line with `exit=0`; an open menu after `broken`; restored Tokyo Night
  * If unsuccessful
  ** Screenshot of the broken desktop
covers: bin/omarchy-theme-colors-from-alacritty, bin/omarchy-theme-set (colors.toml generation), bin/omarchy-theme-set-templates (only with colors.toml)
merged-from: 21:theme-legacy-alacritty-only-theme

### theme-install-git-url-drops-code-files   [VM-OK]
description: `omarchy theme install <git url>` clones a theme, names it from the repo, applies it, and drops every file a stranger's repo may not supply (Lua, terminal configs, vscode.json, symlinks) naming them on stderr while keeping colours; Update → Extra Themes appears and updates it; the user's own (non-git) theme is not filtered. Offline via a local `git init` repo.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter, press Super+F to maximise it, and build a fake upstream repo by typing on one line:
  ** `mkdir -p /tmp/omarchy-forest-theme && cd /tmp/omarchy-forest-theme && sed 's/#2e3440/#003300/' /usr/share/omarchy/themes/nord/colors.toml > colors.toml && echo 'Yaru-red' > icons.theme && echo 'os.execute("touch /tmp/theme-pwned")' > hyprland.lua && echo 'font_family Evil' > kitty.conf && echo '{"name":"x","extension":"evil.ext"}' > vscode.json && echo '# notes' > README.md && mkdir backgrounds && cp /usr/share/omarchy/themes/nord/backgrounds/1-city-view.webp backgrounds/ && ln -s /etc/passwd unlock.png && git init -q && git add -A && git -c user.email=a@b -c user.name=a commit -qm init && cd ~`
  * Before installing: press Super+Space → `Update` — there is no `Extra Themes` row; Escape. Type `omarchy theme remove; echo "exit=$?"` → `No extra themes installed.`, `exit=1`.
  * Type `omarchy theme install file:///tmp/omarchy-forest-theme 2>&1 | sudo tee /dev/ttyS0` (password `prime`).
  ** After the clone lines: `Ignored in /home/prime/.config/omarchy/themes/forest: hyprland.lua kitty.conf unlock.png vscode.json` and `A theme installed from a git repo cannot supply Lua, a terminal config, or vscode.json.` (order may vary); `README.md` is NOT mentioned. The desktop becomes dark green with the Nord city-view wallpaper.
  * Type `ls ~/.local/state/omarchy/current/theme/ | sudo tee /dev/ttyS0` and read the serial: no `vscode.json`, no `unlock.png`; `kitty.conf` and `hyprland.lua` are present but generated: `grep -c Evil ~/.local/state/omarchy/current/theme/kitty.conf` → `0`, `grep -c theme-pwned ~/.local/state/omarchy/current/theme/hyprland.lua` → `0`, `ls /tmp/theme-pwned` → No such file, `cat ~/.local/state/omarchy/current/theme/icons.theme` → `Yaru-red` (colour-ish files are kept), `hyprctl configerrors` → prints nothing.
  * Press Super+Space → `Update`: an `Extra Themes` row is now listed. Select it → floating terminal `Updating: forest` and `Already up to date.` (a file:// remote works offline) → `● Done!`. Press a key.
  * Contrast — the user's own theme is trusted: type `mkdir -p ~/.config/omarchy/themes/mine && cp /usr/share/omarchy/themes/tokyo-night/colors.toml ~/.config/omarchy/themes/mine/ && echo '-- mine marker' > ~/.config/omarchy/themes/mine/hyprland.lua && omarchy-theme-set mine` → nothing is reported ignored and `grep -c 'mine marker' ~/.local/state/omarchy/current/theme/hyprland.lua` → `1`.
  ** A `.git` directory alone marks a theme as installed (`git init` with no commit is enough); the same directory without `.git` is the user's own.
  * Restore: type `omarchy theme set tokyo-night && omarchy theme remove forest && rm -rf ~/.config/omarchy/themes/mine /tmp/omarchy-forest-theme`. Press Super+Space → `Update`: the `Extra Themes` row is gone. Escape.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * On a 4.0.2 disk the staging filter may not exist: if there is no `Ignored in` line and `vscode.json` was staged, record `omarchy-version` and report "staging filter not on this build" rather than failing the install.
  * The stderr lines scroll quickly; the serial copy is authoritative. The theme name is derived from the directory: `omarchy-forest-theme` → `forest`.
  * Do not put real payloads in the user theme — Hyprland would run them by design. The same drop list fires for a community repo over the network (OldJobobo/omarchy-aonagi-theme ships alacritty.toml, foot.ini, ghostty.conf, gum_env.lua, hyprland.lua, kitty.conf, neovim.lua); that path is `theme-install-community-via-menu`.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Serial text with the `Ignored in …: hyprland.lua kitty.conf unlock.png vscode.json` message and the cannot-supply line, not naming README.md; the dark-green Forest desktop; serial listing without vscode.json/unlock.png; the grep counts 0/0, `Yaru-red`, no `/tmp/theme-pwned`, empty `hyprctl configerrors`
  ** The `Extra Themes` row and its update terminal; the user theme keeping its `mine marker` with nothing reported ignored; Extra Themes hidden again after removal; restored Tokyo Night
  * If unsuccessful
  ** The marker found in the staged hyprland.lua or `/tmp/theme-pwned` existing (code not filtered), `vscode.json` staged, the clone failing, Extra Themes missing/present at the wrong time; full install output, `ls -la ~/.local/state/omarchy/current/theme/`, `omarchy-version`
covers: bin/omarchy-theme-install; bin/omarchy-git-url-check (file transport); bin/omarchy-theme-set (stage_installed_theme, denylist, symlink drop; l.20-30, l.234-280); bin/omarchy-theme-extras; bin/omarchy-theme-update; bin/omarchy-theme-remove; omarchy-menu.jsonc install.style.theme, remove.theme, update.themes; test/shell.d/theme-staging-test.sh; test/shell.d/menu-guards-test.sh; docs/theming.md (What an installed theme may not ship); manual/43-making-your-own-theme.md (What an installed theme can contain, Distributing your theme); manual/06-themes.md; default/agents/skills/omarchy/theming.md §What a Theme Installed From a Repo May Not Contain; omarchy-theme-registry README "What gets checked"
merged-from: 21:theme-install-local-git-repo-filters-code; 12:theme-install-local-git-filters-code; 52:theme-install-strips-code-from-git-theme; 60:theme-install-drops-code-files; 61:theme-cloned-repo-drops-code-files

### theme-install-community-via-menu   [VM-OK] [NET]
description: Install → Style → Theme asks for a git URL in a floating terminal and installs a community theme over HTTPS (a few MB), which then shows in the picker and can be updated and removed from Remove → Theme; cancelling the prompt installs nothing.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Space → `Install` → `Style` → `Theme`. A floating terminal shows the Omarchy logo, `See https://omarchy.org/themes/` and the prompt `Git repo URL (https or git@host:org/repo.git)`.
  * Unhappy path first: press Escape. The prompt closes with `● Failed (exit code 1)! Press any key to close...`; press a key. Open a terminal with Super+Enter: `ls ~/.config/omarchy/themes/` → nothing was installed.
  * Repeat the menu path; type `https://github.com/bjarneo/omarchy-ash-theme` and press Enter.
  ** Clone progress (30–60 s over user-mode NAT; poll with screenshots), then the desktop, bar and terminal recolour to Ash's grey palette, then `● Done! Press any key to close...`. Press a key.
  ** If the clone reports the repository does not exist, use `https://github.com/OldJobobo/omarchy-aonagi-theme` instead (violet/blue; it ships extra config files that are dropped and named as `Ignored in …`) and record which URL you used.
  * Press Super+Shift+Ctrl+Space: the picker lists `Ash` with a preview among the built-in themes. Escape.
  * In the terminal type `omarchy theme update` → `Updating: ash` and `Already up to date.`
  * Press Super+Space → `Style` → `Theme` → `Tokyo Night`: stock colours return. Switch away *before* removing — removing the current theme leaves the desktop pointing at a deleted directory.
  * Press Super+Space → `Remove` → `Theme`; click `ash` with the mouse → a `Theme removed` notification with `ash`. Press Super+Shift+Ctrl+Space: Ash is no longer listed. Escape. The desktop is as found.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The "marketplace" is a URL paste; there is no in-desktop browser. The prompt takes literal text — do not type angle brackets. The theme name becomes the repo name minus `omarchy-`/`-theme`.
  * The clone is a few MB; retry once on a network error. A mirror/DNS failure is a NET failure, not an Omarchy one — capture the text either way.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The URL prompt; the Failed banner after Escape and the empty themes directory; clone output and Done; the recoloured desktop and the picker listing Ash; `Already up to date.`; the Remove picker, the notification and the picker without Ash; restored Tokyo Night
  * If unsuccessful
  ** The floating terminal's error text (`Error: Failed to clone theme repo.` or git's message) and the URL used; `ls -la ~/.config/omarchy/themes/`
covers: bin/omarchy-theme-install (gum prompt, empty URL); bin/omarchy-theme-update; bin/omarchy-theme-remove; omarchy-menu.jsonc install.style.theme, remove.theme, style.theme; bin/omarchy-show-done; manual/43-making-your-own-theme.md "Distributing your theme"; omarchy-theme-registry README "Browse and install"
merged-from: 21:theme-install-github-url; 60:theme-install-community-via-menu

### theme-install-refuses-hostile-urls-and-names   [VM-OK]
description: `omarchy theme install` refuses URLs that git would treat as options or remote helpers (`ext::`, `--upload-pack=`, `gcrypt://`, `gopher://`), repository names that would not make a safe theme directory (shell syntax, spaces, `-a`, `..`, `.git`), and reports a clone failure for a repository that does not exist — nothing is written in any case; cancelling the interactive URL prompt installs nothing; `omarchy theme remove` refuses path-climbing names.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter, press Super+F to maximise it, and type `ls ~/.config/omarchy/themes/ 2>/dev/null | wc -l; omarchy-theme-current` → record N (stock: `0`) and `Tokyo Night`.
  * Transport/option refusals — run each with `; echo "exit=$?"` appended; every one is refused instantly on stderr by `omarchy-git-url-check`, exits 1, and creates nothing under `~/.config/omarchy/themes/`:
  ** `omarchy-theme-install "ext::sh -c id"` → `omarchy-git-url-check: 'ext::sh -c id' names a git option or transport helper, not a repository.` (also try the URL-encoded form `ext::sh%20-c%20id`)
  ** `omarchy-theme-install "--upload-pack=touch /tmp/pwned"` and `omarchy-theme-install --upload-pack=/bin/sh` → refused
  ** `omarchy-theme-install "gcrypt://example.com/x"` → refused; `omarchy-theme-install "gopher://x/omarchy-y-theme.git"` → `… names the 'gopher' transport, which Omarchy does not clone from.`
  * Name refusals — each `Error: '…' does not give a usable theme name.`, `exit=1`, before any clone:
  ** `omarchy-theme-install "https://example.com/.git"`, `omarchy-theme-install "https://example.org/..git"`, `omarchy-theme-install "https://example.com/omarchy-..-theme.git"`
  ** `omarchy-theme-install "https://example.com/omarchy-a';id;'b-theme.git"`, `omarchy-theme-install "https://example.com/a b.git"`, `omarchy-theme-install "https://github.com/x/omarchy-bad%20name-theme"`, `omarchy-theme-install "https://example.com/-a.git"`
  * Clone failure (offline): type `omarchy theme install file:///home/prime/no-such-theme; echo "exit=$?"` → a git clone error, then `Error: Failed to clone theme repo.`, `exit=1`, no half-installed directory.
  ** The manual's own example name passes the rule: `omarchy theme install 'https://example.com/omarchy-c++-theme.git'; echo "exit=$?"` reaches `git clone`, which fails against example.com (this one touches the network; `https://github.com/omacom/omarchy-does-not-exist-theme.git` behaves the same) → `Error: Failed to clone theme repo.`, `exit=1`.
  * Type `ls /tmp/pwned` → no such file. Type `touch ~/.config/omarchy/canary`, then `omarchy-theme-remove ..; echo "exit=$?"`, `omarchy-theme-remove .; echo "exit=$?"`, `omarchy-theme-remove ../../evil; echo "exit=$?"` — each fails with `exit=1`, and `ls ~/.config/omarchy/canary` still exists. Type `rm ~/.config/omarchy/canary`.
  * Prompt cancel: type `omarchy theme install` with no argument → a green `See https://omarchy.org/themes/` line and a gum input `Git repo URL (…)`; press Escape → the prompt closes, `echo "exit=$?"` → `exit=1`. Press Super+Space → `Install` → `Style` → `Theme`: the floating terminal shows the same prompt; press Escape → `● Failed (exit code 1)!`, press a key.
  * Type `ls ~/.config/omarchy/themes/ 2>/dev/null | wc -l; omarchy-theme-current` → still N and `Tokyo Night`; the desktop colours are unchanged.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * For the transport, option and name refusals, any `Cloning into` / `Error: Failed to clone theme repo.` output means git was reached — report that as a failure; for the two clone-failure steps that message *is* the expected result. The `ext::`/option checks may be absent on a 4.0.2 disk: record `omarchy-version`.
  * example.com resolves but serves no git repo; that clone error appears within seconds. The gum input has a placeholder; Escape (not Ctrl+C) is the cancel path under test.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of each transport/option/name refusal with its exact message and `exit=1`; the clone-failure output ending `Error: Failed to clone theme repo.` with `exit=1`; the unchanged `~/.config/omarchy/themes/` count and `Tokyo Night`
  ** Screenshot of `/tmp/pwned` absent and `~/.config/omarchy/canary` present after the remove attempts; the gum URL prompt in the terminal and in the floating terminal, both cancelled
  * If unsuccessful
  ** Screenshot of a clone running for a helper/option/bad-name URL, a new or half-installed theme directory, a changed theme, or a missing canary; output of `omarchy-version`; `./client get-serial`
covers: bin/omarchy-theme-install (name allowlist, clone failure, gum prompt; l.19-59); bin/omarchy-git-url-check; bin/omarchy-theme-remove; omarchy-menu.jsonc install.style.theme; test/shell.d/theme-install-guards-test.sh; docs/theming.md:64 (git URLs only); manual/06-themes.md; manual/43-making-your-own-theme.md (Distributing your theme — naming rules; l.41)
merged-from: 52:theme-install-refuses-hostile-urls-and-names; 12:theme-install-rejects-bad-name-and-url; 21:theme-install-rejects-bad-urls; 60:theme-install-rejects-bad-url; 61:theme-install-rejects-bad-url

### theme-remove-menu-and-cli-guards   [VM-OK]
description: Remove → Theme lists only user-installed themes and deletes the chosen one with a notification, with none installed it says so, and removal cannot touch a shipped theme, an unknown name or a path-like name — the 22 stock themes stay intact.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `for n in alpha beta; do mkdir -p ~/.config/omarchy/themes/$n && cp /usr/share/omarchy/themes/nord/colors.toml ~/.config/omarchy/themes/$n/; done`.
  * Type `omarchy theme remove alpha` → `Removed alpha` and a toast titled `Theme removed` with body `alpha`.
  * Press Super+Space → `Remove` → `Theme`. A small picker titled `Remove extra theme` lists only `beta` (no stock names). Click it with the mouse.
  ** Toast `Theme removed` / `beta`.
  * Press Super+Space → `Remove` → `Theme` again: with no extras nothing is removed; in the terminal `omarchy-theme-remove; echo "exit=$?"` → `No extra themes installed.`, `exit=1`.
  * Refusals: type `omarchy theme remove tokyo-night; echo "exit=$?"` → `Error: Theme 'tokyo-night' not found.`, `exit=1`; `omarchy theme remove nope; echo "exit=$?"` → `Error: Theme 'nope' not found.`, `exit=1`; `omarchy theme remove ../themes; echo "exit=$?"` → no message, `exit=1`; `omarchy theme remove /tmp; echo "exit=$?"` → no message, `exit=1`; `ls /tmp` still works.
  * Type `ls /usr/share/omarchy/themes | wc -l` → `22` and `ls ~/.config/omarchy/themes/` → empty; the desktop is unchanged.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The picker is a compact list; Escape cancels it. Stock themes can never be removed — the command looks only in `~/.config/omarchy/themes`.
  * All CLI refusals are instant; one maximised terminal screenshot at the end covers them.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** `Removed alpha` with its toast; the picker showing only beta; the beta toast; `No extra themes installed.`; the two `not found` errors, two silent exit-1s, `22`, and the empty directory
  * If unsuccessful
  ** The command output, the picker screenshot, any removal exiting 0 or a count below 22
covers: bin/omarchy-theme-remove (guards); omarchy-menu.jsonc remove.theme; bin/omarchy-menu-select; bin/omarchy-notification-send; test/shell.d/theme-install-guards-test.sh (remove section)
merged-from: 21:theme-remove-extra-theme; 21:theme-remove-rejects-stock-missing-and-paths

### theme-remove-active-user-theme-unguarded   [VM-OK]
description: Removing the theme that is currently active must be refused (`… is the active theme`) or preceded by an automatic switch — the guard that shipped in 2025 and was lost in the January 2026 template refactor (03-INTENDED-BEHAVIOUR #8, DEFECT/regression). Observed at HEAD: the directory is removed silently, the desktop keeps its rendered colours, and the theme can no longer be re-applied or refreshed.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `mkdir -p ~/.config/omarchy/themes/gone && cp /usr/share/omarchy/themes/gruvbox/colors.toml ~/.config/omarchy/themes/gone/ && omarchy-theme-set gone`. The bar recolours to Gruvbox tones (a toast about no background is expected); `omarchy-theme-current` → `Gone`.
  * Type `omarchy theme remove gone; echo "exit=$?"`.
  ** Intended: a refusal naming it as the active theme with a non-zero exit (or an automatic switch to another theme before the removal), and `ls ~/.config/omarchy/themes/` still lists `gone` (or the desktop is already on another theme).
  ** Observed at HEAD: `Removed gone`, `exit=0`, no warning that it was active — record this as the defect and continue.
  * Type `omarchy-theme-current` → still `Gone` while the desktop is unchanged (the rendered copy keeps it alive).
  * Type `omarchy-theme-set gone; echo "exit=$?"` and `omarchy-theme-refresh; echo "exit=$?"` → each `Theme 'gone' does not exist`, `exit=1`.
  * Type `omarchy-theme-set tokyo-night`; the desktop recovers. Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The intended behaviour is the pass condition; the HEAD behaviour above is the expected *failure* today. Report which one you saw, with `omarchy-version`.
  * The manual does not describe theme removal at all, so this is a code regression, not a doc disagreement.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The refusal (or the automatic switch) on `omarchy theme remove gone`, `gone` still present or the desktop already elsewhere; recovered Tokyo Night
  * If unsuccessful
  ** `Removed gone` with `exit=0`; `Gone` still current; `Theme 'gone' does not exist` with `exit=1` from both `theme-set` and `theme-refresh` (the defect, recorded); a broken desktop (no bar) after the removal would be a second, worse finding; `omarchy-version`
covers: bin/omarchy-theme-remove (no active-theme guard), bin/omarchy-theme-refresh, bin/omarchy-theme-current, bin/omarchy-theme-set
merged-from: 21:theme-remove-active-user-theme

### theme-user-templates-render-on-switch   [VM-OK]
description: A `.tpl` the user drops into `~/.config/omarchy/themed/` is rendered with the theme's palette on every switch or refresh (with `_strip`/`_rgb`/`mix` modifiers, unknown placeholders left literal), and a user template replaces the built-in one for the same output file.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter, press Super+F to maximise it, and type `ls ~/.config/omarchy/themed/` → `alacritty.toml.tpl.sample`.
  * Type `printf 'bg={{ background }}\nacc={{ accent_strip }}\nfg_rgb={{ foreground_rgb }}\nmixed={{ mix background foreground 50%% }}\nunknown={{ nope }}\n' > ~/.config/omarchy/themed/mytest.txt.tpl && printf '# user kitty template\n' > ~/.config/omarchy/themed/kitty.conf.tpl`.
  * Type `omarchy-theme-refresh` (re-renders without changing the wallpaper — confirm it did not move), then `cat ~/.local/state/omarchy/current/theme/mytest.txt ~/.local/state/omarchy/current/theme/kitty.conf`.
  ** Expected on Tokyo Night: `bg=#1a1b26`, `acc=7aa2f7`, `fg_rgb=169,177,214`, `mixed=#62667e`, `unknown={{ nope }}` left literally, then the single line `# user kitty template` (the 27-line built-in was replaced).
  * Type `omarchy-theme-set nord && head -1 ~/.local/state/omarchy/current/theme/mytest.txt` → `bg=#2e3440`.
  * Override a shipped template from the sample: type `sed 's/^# HOW TO USE.*//' ~/.config/omarchy/themed/alacritty.toml.tpl.sample > ~/.config/omarchy/themed/alacritty.toml.tpl && echo '# PROBE-USER-TEMPLATE' >> ~/.config/omarchy/themed/alacritty.toml.tpl && omarchy-theme-set tokyo-night && grep -c PROBE-USER-TEMPLATE ~/.local/state/omarchy/current/theme/alacritty.toml` → `1`.
  * Restore: type `rm ~/.config/omarchy/themed/*.tpl && omarchy-theme-set tokyo-night && wc -l ~/.local/state/omarchy/current/theme/kitty.conf` → `27` (built-in back) and `ls ~/.local/state/omarchy/current/theme/mytest.txt` → `No such file`.
  ** Re-applying tokyo-night advances its wallpaper each time; expected.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * This feature only shows in files, so the maximised terminal is the screen here.
  * Templates only render for themes with colors.toml; every shipped theme has one.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Terminal showing the five rendered values (exact hex above) and the one-line kitty.conf; `bg=#2e3440` on Nord; grep count 1 for the user alacritty template; the clean-up state (`27`, No such file)
  * If unsuccessful
  ** `ls ~/.config/omarchy/themed/`, the rendered file contents or placeholders unreplaced, `./client get-serial`
covers: bin/omarchy-theme-set-templates (user templates first, mix/strip/rgb); bin/omarchy-theme-refresh (SKIP_BACKGROUND); config/omarchy/themed/alacritty.toml.tpl.sample; docs/theming.md "Template placeholders"; manual/43-making-your-own-theme.md (Theming apps Omarchy doesn't cover)
merged-from: 21:theme-user-templates; 12:themed-user-template-generates-file

### theme-refresh-repairs-rendered-file   [VM-OK]
description: `omarchy-theme-refresh` regenerates the active theme's files after the user breaks one, without moving the wallpaper.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `echo 'broken=garbage' > ~/.local/state/omarchy/current/theme/foot.ini`.
  * Open a new terminal with Super+Enter. It opens in plain default colours (black background, white text) instead of Tokyo Night — the symptom.
  * In either terminal type `omarchy-theme-refresh; echo "exit=$?"`. It returns silently with `exit=0`. The wallpaper does not change.
  * Open another new terminal with Super+Enter; it opens in Tokyo Night navy again. Close the extra terminals with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If foot refuses to start with the broken include, use the first terminal for the refresh and report it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** A plain black-and-white new terminal; a navy new terminal after the refresh; the same wallpaper throughout
  * If unsuccessful
  ** The `omarchy-theme-refresh` exit code and `head -3 ~/.local/state/omarchy/current/theme/foot.ini`
covers: bin/omarchy-theme-refresh, bin/omarchy-theme-set (OMARCHY_THEME_SKIP_BACKGROUND)
merged-from: 21:theme-refresh-repairs-rendered-file

### theme-terminal-and-tmux-retint-live   [VM-OK]
description: A theme switch repaints terminals that are already open — including a running tmux pane, which also carries the new palette in its environment — without restarting anything, and new terminals open in the new palette.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `ls --color=always /usr/share/omarchy/bin | head -40` so coloured text is on screen.
  * Open a second terminal with Super+Enter (it tiles beside the first) and type `tmux`, then `echo hello` inside it.
  * Click the first terminal and type `omarchy-theme-set gruvbox`.
  ** Within ~3 s the first terminal's background turns dark grey and its text warm, with the `ls` output still there, and the tmux pane in the second terminal repaints too — tmux is not restarted.
  * Open a third terminal with Super+Enter; it opens already in Gruvbox colours. In it type `omarchy-theme-set catppuccin-latte`: all panes turn light (pale background, dark text); `tmux show-environment -g COLORFGBG` → `COLORFGBG=0;15`.
  * Type `omarchy-theme-set tokyo-night`: all three terminals repaint to navy; `tmux show-environment -g COLORFGBG` → `COLORFGBG=15;0`.
  * Click the second terminal and type `exit` to leave tmux; close the extra terminals with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Keep the terminals visible; side-by-side before/after screenshots are the proof. The tmux status line keeps its own colours; only the pane background/foreground is expected to change.
  * Foot cannot reload its config; this repaint is done with escape sequences, so it should be near-instant.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Terminal 1 and the tmux pane in Tokyo Night; both in Gruvbox with the earlier output intact; a new terminal in Gruvbox; all light under Catppuccin Latte with `COLORFGBG=0;15`; all navy again with `COLORFGBG=15;0`
  * If unsuccessful
  ** Screenshot of a terminal or pane that kept its old colours and `tmux show-options -g window-style`
covers: bin/omarchy-theme-set-foot; bin/omarchy-theme-osc; default/themed/foot.ini.tpl; config/foot/foot.ini include; bin/omarchy-restart-terminal; bin/omarchy-theme-set-tmux; default/themed/gum_env.lua.tpl
merged-from: 21:theme-terminal-retint-live; 21:theme-tmux-sync

### restart-helpers-quiet-when-target-absent   [VM-OK]
description: The `omarchy-restart-*` helpers a theme switch calls reload a live terminal, source tmux config when a session exists, restart the fcitx5 unit for XCompose, expose the theme's gum colours, and are silent no-ops when their target (btop, helix, opencode, herdr) is not running.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy-restart-terminal; echo "exit=$?"` → `exit=0`; the terminal itself stays open (foot cannot reload; alacritty re-reads its config, kitty/ghostty get a reload signal — none is installed on the stock disk, so nothing visible changes).
  * Type `omarchy-restart-tmux; echo "exit=$?"` → `exit=0` with no session. Then `tmux new -d -s t && omarchy-restart-tmux; echo "exit=$?"; tmux kill-server` → `exit=0`.
  * Type `omarchy-restart-btop; omarchy-restart-helix; omarchy-restart-opencode; omarchy-restart-herdr; echo "exit=$?"` → nothing printed (none running); a 0 or 1 exit is acceptable for the `pkill`-based ones — report what you see.
  * Type `systemctl --user is-active omarchy-fcitx5.service` (note it); `omarchy-restart-xcompose; echo "exit=$?"` → `exit=0`; `systemctl --user show -p ActiveEnterTimestamp --value omarchy-fcitx5.service` → a timestamp within the last seconds; `pgrep -x fcitx5` → one PID.
  * Type `source omarchy-restart-gum; echo "$GUM_CONFIRM_PROMPT_FOREGROUND $BORDER_FOREGROUND"` → two colour values (the theme's accent) from `~/.local/state/omarchy/current/theme/gum_env.lua`.
  * Unhappy path: type `omarchy-restart-app; echo "exit=$?"` with no argument → `pkill` usage noise and a non-zero exit is acceptable; report what you see. Close the terminal with Super+W; the desktop is as found.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * All commands are instant; maximise the terminal (Super+F) so one screenshot per step is readable.
  * Caps Lock is the Compose key on Omarchy; restarting fcitx5 briefly interrupts input — wait a second before typing the next command.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Terminal screenshots with the exit codes, the fcitx5 timestamp change and single PID, and the two gum colour values
  * If unsuccessful
  ** `systemctl --user status omarchy-fcitx5.service` if the unit is missing or failed; any helper printing an error for an absent target
covers: bin/omarchy-restart-terminal; bin/omarchy-restart-tmux; bin/omarchy-restart-btop; bin/omarchy-restart-helix; bin/omarchy-restart-opencode; bin/omarchy-restart-xcompose; bin/omarchy-restart-herdr; bin/omarchy-restart-gum; bin/omarchy-restart-app
merged-from: 25:restart-terminal-tmux-xcompose-and-quiet-helpers

### theme-btop-retint   [VM-OK]
description: The Activity monitor (btop) draws in the current theme and repaints live when the theme changes.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Ctrl+T. btop opens in a terminal window with Tokyo Night colours (blue/purple boxes).
  ** If nothing opens, open a terminal and type `btop`, and report the hotkey miss.
  * Open another terminal with Super+Enter and type `omarchy-theme-set retro-82`.
  ** Within 3 s btop's boxes change to the Retro-82 palette without being restarted (its uptime counter keeps running).
  * Type `omarchy-theme-set gruvbox`; btop repaints again in brown/olive.
  * Type `omarchy-theme-set tokyo-night`; btop is blue/purple again. Click on btop and press `q` to quit; close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * btop may need a second to redraw after the signal; take two screenshots.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The same btop window in Tokyo Night, Retro-82, Gruvbox and Tokyo Night again
  * If unsuccessful
  ** btop screenshot with stale colours
covers: install/user/theme.sh (btop symlink), default/themed/btop.theme.tpl, themes/retro-82/btop.theme, bin/omarchy-restart-btop
merged-from: 21:theme-btop-retint

### theme-neovim-colorscheme-follows-theme   [VM-OK]
description: Neovim's colourscheme follows the theme — a theme with its own scheme (Tokyo Night, Gruvbox) shows it, a theme with only a generated palette (Ethereal) reports `aether` via the preinstalled aether.nvim plugin. Reviewer 21 says Tokyo Night ships its own `neovim.lua`; reviewer 60 expects `aether` on a fresh nvim — the driver records what `:colorscheme` prints on Tokyo Night.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `nvim /etc/os-release`. The buffer is in Tokyo Night colours. Type `:colorscheme` and Enter; record the name printed (21 expects the theme's own scheme, 60 expects `aether`). Type `:q` and Enter.
  ** If a plugin-install window appears, wait for it (10–20 s) and press `q`; a download prompt inside it means the pre-built plugin cache is missing — screenshot it.
  * Type `omarchy-theme-set ethereal`, then `nvim /etc/os-release` again.
  ** The buffer background is near-black blue and the text peach. Type `:colorscheme` Enter → `aether`. Type `:Lazy` Enter: the plugin list contains `aether` (from bjarneo/aether.nvim); press `q`. Quit with `:qa!`.
  * Type `omarchy-theme-set gruvbox`, then `nvim /etc/os-release`; the classic Gruvbox scheme (dark grey, cream text). Quit with `:q`.
  * Type `omarchy-theme-set tokyo-night` and close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The first nvim start after a theme change may sync plugins (a Lazy window) for 10–20 s; poll with screenshots.
  * A red `Error` line at nvim start is a failure; capture it. If `:colorscheme` prints something unexpected, also run `:echo g:colors_name`.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Three nvim screenshots with visibly different schemes matching the theme; `:colorscheme` output on Tokyo Night recorded; `aether` printed on Ethereal and `:Lazy` listing aether
  * If unsuccessful
  ** The nvim error text on screen, the Lazy error or download prompt; `pacman -Q omarchy-nvim`
covers: default/themed/neovim.lua.tpl (l.1-10, l.47-51); themes/tokyo-night/neovim.lua; themes/gruvbox/neovim.lua; docs/theming.md (hand-written overrides win); manual/16-neovim.md; omarchy-pkgs/pkgbuilds/omarchy-nvim
merged-from: 21:theme-neovim-colorscheme; 60:nvim-aether-colorscheme

### theme-lumon-fetches-lumon-nvim   [VM-OK] [NET]
description: Switching to the Lumon theme makes Neovim fetch the org colorscheme omacom-io/lumon.nvim (a few hundred KB) and activate `lumon`; switching back to Tokyo Night returns Neovim to its default scheme.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Space → `Style` → `Theme` → `Lumon`. The desktop recolours to Lumon's palette.
  * Open a terminal with Super+Enter and type `nvim`.
  ** Lazy installs `lumon.nvim` (a short download); wait, press `q` if the window stays.
  * Type `:colorscheme` Enter → `lumon`.
  * Type `:qa!` Enter, then Super+Space → `Style` → `Theme` → `Tokyo Night`.
  * Type `nvim`, then `:colorscheme` Enter → `aether` (or the Tokyo Night scheme — record which; see `theme-neovim-colorscheme-follows-theme`). Type `:qa!` Enter and close the terminal with Super+W.
  ** The desktop is as found; the downloaded plugin stays in Neovim's plugin cache (harmless).
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * A Lazy clone error is the finding — screenshot it and check connectivity with `curl -sI https://github.com | head -1`.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the Lumon desktop and of `:colorscheme` printing lumon; `:colorscheme` after switching back
  * If unsuccessful
  ** Screenshot of the Lazy error; `cat ~/.local/state/omarchy/current/theme/neovim.lua`
covers: themes/lumon/neovim.lua l.3-9; manual/06-themes.md "Lumon"
merged-from: 60:lumon-theme-fetches-lumon-nvim

### theme-hyprland-border-and-overrides   [VM-OK]
description: The focused window's border takes the theme accent, and a theme with its own Hyprland file (Kanagawa off-white, Last Horizon gradient) overrides the generated colour.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open two terminals with Super+Enter twice so one is focused and one is not. The focused one has a blue border, the other grey.
  * In the focused terminal type `omarchy-theme-set gruvbox`. The focused border turns teal.
  * Type `omarchy-theme-set kanagawa`. The focused border is off-white (that theme ships its own Hyprland file).
  * Type `omarchy-theme-set last-horizon`. The focused border shows a two-tone grey-to-white gradient.
  * Type `omarchy-theme-set tokyo-night`; the border is blue again. Close the extra terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Borders are 2 px; take full-resolution screenshots and look at the window edges.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots showing the focused border blue, teal, off-white, gradient, blue
  * If unsuccessful
  ** Screenshot of a border that did not change; in a terminal `hyprctl reload` output
covers: default/themed/hyprland.lua.tpl (hypr_gradient), themes/kanagawa/hyprland.lua, themes/last-horizon/hyprland.lua, bin/omarchy-restart-hyprctl, default/hypr/omarchy.lua
merged-from: 21:theme-hyprland-border-and-overrides

### theme-shell-section-override-lock-screen   [VM-OK]
description: Tokyo Night's lock screen uses its own muted colours (a per-section shell override) while other themes' lock screens use the generated ones, and the override leaves no duplicate section.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Ctrl+L. The lock screen's password field border and text are muted blue-grey, not the bright accent blue.
  ** The lock screen blanks to black 5 s after the last input; a mouse move wakes it and keys still go to the password field. There is no clock or user name — only the field.
  * Type `prime` and Enter to unlock.
  * Open a terminal with Super+Enter and type `omarchy-theme-set gruvbox`.
  * Press Super+Ctrl+L. The password field is now in Gruvbox cream/teal (generated colours). Unlock with `prime`.
  * Type `grep -c '^\[lock\]' ~/.local/state/omarchy/current/theme/shell.toml` → `1` (the override must not leave a duplicate section).
  * Type `omarchy-theme-set tokyo-night` and close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Screenshot the lock screen immediately after locking, before it blanks; take a second screenshot ~1 s after waking.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Tokyo Night lock screen in muted blue-grey; Gruvbox lock screen in cream/teal; `1`; restored desktop
  * If unsuccessful
  ** The lock screen screenshot and the grep count
covers: bin/omarchy-theme-set-templates (apply_shell_section_overrides), themes/tokyo-night/shell.lock.toml, docs/theming.md "shell.toml"
merged-from: 21:theme-shell-section-override

### theme-chromium-policy-colour-follows-theme   [VM-OK]
description: A theme switch recolours Chromium's toolbar through a root-owned 0755 policy directory without any password prompt (a scoped NOPASSWD sudo rule), the policy helper refuses anything but six lowercase hex digits, and files planted in the policy directory are dropped.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter, press Super+F, and type `stat -c '%U:%G %a %n' /etc/chromium /etc/chromium/policies /etc/chromium/policies/managed /etc/chromium/policies/managed/color.json; cat /etc/chromium/policies/managed/color.json` → dirs `root:root 755`, file `root:root 644`, `"BrowserThemeColor": "#xxxxxx"` (six lowercase hex).
  * Press Super+F again, type `chromium &`. Chromium opens (20–30 s without GPU; click **Wait** if Hyprland's "not responding" dialog appears) with a dark navy toolbar.
  * In the terminal type `omarchy-theme-set flexoki-light; sleep 3; cat /etc/chromium/policies/managed/color.json`.
  ** No password or polkit dialog may appear. The file shows the light colour `#f2f0e5`; within a few seconds Chromium's toolbar turns pale cream and the wallpaper is light. In Chromium click the address bar, type `chrome://policy`, Enter: the row `BrowserThemeColor` shows `#f2f0e5`.
  * In the terminal type `sudo -n -l -l 2>/dev/null | grep -A2 omarchy-theme-set-browser-policy` → the `NOPASSWD` rule for `/usr/bin/omarchy-theme-set-browser-policy` with six `[0-9a-f]` classes.
  * Type `omarchy-theme-set-browser-policy GGGGGG; echo "exit=$?"` → `expected six lowercase hex digits, got 'GGGGGG'`, `exit=1`.
  * Type `sudo touch /etc/chromium/policies/managed/evil.json && sudo chown prime /etc/chromium/policies/managed/evil.json && omarchy-theme-set-browser; ls -l /etc/chromium/policies/managed/` (only this `sudo` asks for `prime`) → `evil.json` is gone, `color.json` still `root 644`.
  * Type `omarchy-theme-set tokyo-night; sleep 3; cat /etc/chromium/policies/managed/color.json` → a dark colour, again no prompt; Chromium's toolbar is navy again. Close Chromium (Ctrl+Shift+Q or Super+W) and the terminal.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If a polkit password dialog appears during a theme switch, enter `prime`, let it finish, and report it: the passwordless rule is missing on this build (record `omarchy-version`).
  * Chromium's toolbar follows the policy live; if it does not, reload the page and note it. Firefox/Zen are absent on the stock disk, so their `distribution/policies.json` half is skipped.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The stat/cat output; Chromium navy; Chromium cream after the switch with no prompt on screen and the `chrome://policy` row `#f2f0e5`; the sudoers listing; the `GGGGGG` rejection; `evil.json` dropped with `color.json` root 644; Chromium navy again
  * If unsuccessful
  ** Screenshot of a polkit/sudo prompt during the switch, a toolbar that did not change, a non-root or non-755 directory, or `evil.json` surviving
covers: bin/omarchy-theme-set-browser; bin/omarchy-theme-set-browser-policy; etc/sudoers.d/omarchy-theme-browser; themes/flexoki-light/chromium.theme; default/themed/chromium.theme.tpl; install/helpers/browser-policy.sh; test/shell.d/browser-policy-dir-test.sh; test/shell.d/browser-policy-sudoers-test.sh (grant/elevation); test/shell.d/default-apps-test.sh (Chromium installer policy dirs); manual/23-browsers.md
merged-from: 21:theme-browser-policy-colour; 51:browser-policy-color-follows-theme

### theme-obsidian-sync   [VM-OK]
description: An Obsidian vault receives an "Omarchy" community theme that follows the system theme on every switch.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Space → `Apps`, type `obsidian`, Enter. In its welcome dialog click `Create` new vault, name it `Vault`, keep the default location (home), click `Create`.
  ** Obsidian is slow without GPU; allow 30 s per step and poll with screenshots. Click **Wait** if Hyprland's "not responding" dialog appears.
  * Open a terminal with Super+Enter and type `omarchy-theme-set gruvbox`.
  * In Obsidian open Settings (the gear, bottom-left) → `Appearance` → `Themes` → `Manage`: a theme named `Omarchy` is listed. Click it; the editor turns Gruvbox grey/cream.
  * In the terminal type `omarchy-theme-set catppuccin-latte`; Obsidian's editor turns light within a few seconds (it hot-reloads the theme file).
  * Type `omarchy-theme-set tokyo-night`; close Obsidian (Super+W); type `rm -rf ~/Vault` and close the terminal.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If Obsidian shows a "trust plugins" prompt for the vault, accept it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Obsidian's theme list with `Omarchy`; the editor in Gruvbox colours; the editor light under Catppuccin Latte
  * If unsuccessful
  ** In the terminal `ls ~/Vault/.obsidian/themes/Omarchy/` and the Obsidian screenshot
covers: bin/omarchy-theme-set-obsidian, default/themed/obsidian.css.tpl
merged-from: 21:theme-obsidian-sync

### theme-hooks-absent-apps-and-hardware-stay-silent   [VM-PARTIAL]
description: On a disk without Claude/Hermes/T3/VS Code and with no RGB keyboard controller, the per-app and keyboard theme hooks exit quietly, Pi's theme file and the keyboard colour file are still kept current, and asking to activate an absent app gives a clear message. Skipped: the apps' own UIs and the hardware path.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `grep '"background"' ~/.pi/agent/themes/omarchy-system.json` → `"#1a1b26"`; `cat ~/.local/state/omarchy/current/theme/keyboard.rgb` → `ff00ff` (Tokyo Night's own value).
  * Type `omarchy-theme-set nord && grep '"background"' ~/.pi/agent/themes/omarchy-system.json` → `"#2e3440"` (Pi is kept current).
  * Type `omarchy-theme-set gruvbox && cat ~/.local/state/omarchy/current/theme/keyboard.rgb` → `#7daea3` (generated from the accent).
  * Type `omarchy-theme-set-claude; omarchy-theme-set-t3code; omarchy-theme-set-vscode; omarchy-theme-set-keyboard; echo "exit=$?"` → no output, `exit=0` (apps and hardware absent, hooks silent).
  * Type `ls ~/.hermes/skins 2>&1; omarchy-theme-set-hermes --activate; echo "exit=$?"; ls ~/.hermes/skins 2>&1` → `skins` does not exist before or after; stderr `Hermes is not set up yet; launch it once, then run omarchy-theme-set-hermes --activate.` and `exit=0` — nothing written for a Hermes that never ran.
  * Give Hermes a config: type `mkdir -p ~/.hermes; printf 'display:\n  skin: default\n' > ~/.hermes/config.yaml; omarchy-theme-set-hermes; echo "exit=$?"; ls ~/.hermes/skins/` → `exit=0` and `omarchy.yaml` is published (Hermes itself is not run). Then `omarchy-theme-set-hermes --activate 2>&1 | tail -2` → prints the `hermes config set display.skin omarchy` command the user can run once Hermes is ready.
  * Type `omarchy-theme-set-pi --bogus; echo "exit=$?"` → `Usage: omarchy-theme-set-pi [--activate]`, `exit=1`.
  * Type `rm -r ~/.hermes/skins ~/.hermes/config.yaml; omarchy-theme-set tokyo-night` and close the terminal with Super+W.
  ** `~/.hermes` itself may already exist (skills are linked there by a migration); only `skins` and `config.yaml` are this test's.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Skipped part: the apps' UIs, activation on a running Hermes (`config get/set display.skin`, needs Hermes Desktop) and any ASUS/Framework keyboard; only the no-device/no-app paths run. If `~/.claude` or `~/.hermes/config.yaml` already exists on this build, note it and skip that app's "absent" expectation.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Terminal with the two Pi values, the two keyboard.rgb values, the silent `exit=0`, the Hermes `not set up yet` note with no skins dir, `omarchy.yaml` published once a config exists, the printed `hermes config set` command, the usage error, and the clean-up
  * If unsuccessful
  ** The command output that differed, a skin written for a Hermes that never ran, any error text from the keyboard hook
covers: bin/omarchy-theme-set-pi, -claude, -hermes, -t3code, -vscode, -keyboard, -asus-rog, -f16; install/user/theme.sh (pi --activate); default/themed/keyboard.rgb.tpl; themes/tokyo-night/keyboard.rgb; test/shell.d/hermes-theme-test.sh (never-ran, publish, unready --activate); test/shell.d/vscode-theme-test.sh; manual/17-ai.md
merged-from: 21:theme-agent-syncs-without-apps; 21:theme-keyboard-rgb-absent-hardware; 51:hermes-theme-hook-without-hermes

### theme-preview-palette-in-terminal   [VM-OK]
description: `omarchy dev theme-preview` shows a theme's palette, ramps and samples in the terminal, recolours only that terminal (or none with `--no-osc`), and reports an unknown theme.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter, press Super+F to maximise, and type `omarchy dev theme-preview gruvbox`.
  ** Header `Theme: gruvbox`, `File: /usr/share/omarchy/themes/gruvbox/colors.toml`, `Mode:  dark`, a contrast ratio, then coloured swatch rows, a gradient strip, a `selected text` sample and ANSI strips. The terminal's own background turned Gruvbox grey (OSC applied to this terminal only).
  * Press Super+F, then open a second terminal with Super+Enter; it is still Tokyo Night navy — the desktop theme did not change.
  * In the second terminal type `omarchy dev theme-preview white --no-osc`. Swatches are printed but this terminal stays navy; `Mode:  light`.
  * Type `omarchy dev theme-preview nope; echo "exit=$?"` → `Theme not found: nope`, `exit=1`.
  * Close both terminals (Super+W each).
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The preview retints only the terminal it runs in; that is the point of the second terminal.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The Gruvbox preview in a Gruvbox-coloured terminal; a navy second terminal beside it; the white preview with the terminal still navy; `Theme not found: nope` with `exit=1`
  * If unsuccessful
  ** The error text or a second terminal that changed colour
covers: bin/omarchy-dev-theme-preview, bin/omarchy-theme-osc, bin/omarchy-theme-color
merged-from: 21:theme-preview-palette-in-terminal

### theme-sync-chromium-extension   [VM-OK] [NET]
description: omarchy-theme-sync, installed from a git checkout, appears in Chromium's extensions page and exposes the current Omarchy theme name to web pages, updating when the theme changes; it is removed at the end.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Shift+Return to open Chromium once (so a profile exists; click **Wait** on a "not responding" dialog), then close it with Super+W.
  * Open a terminal with Super+Enter and type `git clone --depth 1 https://github.com/omacom/omarchy-theme-sync.git ~/omarchy-theme-sync && cd ~/omarchy-theme-sync && ./install.sh`.
  ** The installer registers the extension and helper without sudo and prints a success summary.
  * Press Super+Shift+Return; press Ctrl+L, type `chrome://extensions`, Enter → "Omarchy Theme Sync" is listed and enabled.
  * Ctrl+L, type `https://omarchy.org`, Enter; press Ctrl+Shift+J and in the console type `window.omarchy && window.omarchy.theme` Enter → the current theme name (e.g. `tokyo-night`).
  * Super+Space → `Style` → `Theme` → `Nord`; back in the console, after 3 seconds, run `window.omarchy.theme` again → `nord`.
  * Super+Space → `Style` → `Theme` → `Tokyo Night`; close Chromium; in the terminal run `cd ~ && (~/omarchy-theme-sync/uninstall.sh 2>/dev/null || sed -i '/omarchy-theme-sync/d' ~/.config/chromium-flags.conf); rm -rf ~/omarchy-theme-sync` and close it. The desktop is as found.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The extension's helper watches the theme with inotify; give it 2–3 seconds after switching before re-reading.
  * If the checkout has an `uninstall.sh`, it is preferred over the sed line (the command above tries it first).
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of install.sh finishing; chrome://extensions with Omarchy Theme Sync enabled; the console printing tokyo-night, then nord after the switch
  * If unsuccessful
  ** Screenshot of the extension missing or `window.omarchy` undefined; `cat ~/.config/chromium-flags.conf`
covers: omarchy-theme-sync README "Install", "Use the JavaScript API"; default/chromium (flags file)
merged-from: 60:theme-sync-chromium-extension

### install-t3-code-themed-and-remove   [VM-OK] [NET]
description: Install → AI → T3 Code installs the app (~100 MB) and hands it the current Omarchy palette before its first launch; Remove → AI → T3 Code deletes the package and `~/.t3`.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Space → `Install` → `AI` → `T3 Code`.
  ** Floating terminal: `Installing T3 Code...`, sudo `prime`, ~100 MB download (1–3 min; poll with screenshots), `Matching T3 Code to the current theme...`, a `t3 theme set` confirmation, `Opening T3 Code...`, `T3 Code has been installed.`, `Done!`.
  * Within ~15 s a T3 Code window opens using the Omarchy colours; screenshot and close it (Super+W).
  * Open a terminal with Super+Enter and type `cmp ~/.local/state/omarchy/current/theme/t3code.json ~/.t3/userdata/themes/omarchy.json && echo same` → `same`.
  * Press Super+Space → `Install` → `AI`: `T3 Code` is dim with a ✓ (reopen the menu twice if the guard has not repainted). Then `Remove` → `AI` → `T3 Code` → floating terminal `T3 Code has been removed.` → `Done!`.
  * In the terminal type `ls -d ~/.t3 ~/.config/t3code 2>&1` → both `No such file`; press Super+Alt+Space, type `t3` → no entry. Escape; close the terminal.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If the palette was missing before install, the script renders it itself; `same` must still print.
  * Menu guards paint from the previous evaluation: reopen the menu twice before asserting the ✓.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Install output including the theme step; the themed T3 window; `same`; the dim ✓ row; the removal output; both dirs gone and no Apps entry
  * If unsuccessful
  ** `T3 theme selection failed` or the `Failed` banner text
covers: bin/omarchy-install-ai-t3-code; bin/omarchy-remove-ai-t3-code; default/omarchy/omarchy-menu.jsonc (install.ai.t3-code, remove.ai.t3-code); test/shell.d/t3code-install-test.sh
merged-from: 23:install-ai-t3-code-themed-and-remove

### aether-theme-from-wallpaper   [VM-OK]
description: Aether, the preinstalled theming app in the Apps menu, launches (software-rendered), turns a wallpaper into a palette and applies it as a new Omarchy theme that the theme picker lists; Extract without a wallpaper is refused; the stock theme is restored and the new theme removed at the end.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Alt+Space to open the Apps menu, type `Aether`, press Enter.
  ** An "Aether" entry is listed. Within ~15 s a window titled Aether opens with a wallpaper column, a 16-swatch palette area and Extract / Apply buttons (may be oversized). A white window for several seconds is normal — software rendering.
  * Unhappy path: click Extract before choosing a wallpaper. It is disabled or asks for a wallpaper first; no crash.
  * Use the wallpaper file picker; in the dialog press Ctrl+L, type `/usr/share/omarchy/themes/tokyo-night/backgrounds/`, Enter, then double-click the first image. The wallpaper preview appears in Aether.
  * Click Extract, wait for the swatches to fill (a few seconds on 2 vCPU), then click Apply Theme; if asked for a name, enter `vmtest`.
  ** The desktop, bar and any open terminal recolour to the extracted palette. Aether may show a confirmation toast — screenshot it.
  * Press Super+Shift+Ctrl+Space: the theme picker lists the new theme (`vmtest` or the name Aether chose). Press Escape.
  * Restore: Super+Space → `Style` → `Theme` → `Tokyo Night`; close Aether with Super+W. Open a terminal with Super+Enter: `pacman -Q aether` → a version line; `omarchy theme remove vmtest` (or the name Aether chose) → `Removed vmtest`. The desktop is as found.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Aether is a WebKit app rendering in software: do not click Extract twice; if the window is black for a while, wait. Report a crash dialog if one appears.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the Apps menu entry and the Aether window; the disabled/complaining Extract with no wallpaper; the wallpaper loaded and the extracted swatches; the recoloured desktop after Apply; the theme picker listing the new theme; Tokyo Night restored, `pacman -Q aether` and `Removed vmtest`
  * If unsuccessful
  ** Screenshot of the blank window, no Apps entry, or the failed Apply; `pacman -Q aether`; `./client get-serial`
covers: manual/22-guis.md "Aether"; manual/43-making-your-own-theme.md (Aether, l.7); aether README "Basic Usage"; install/omarchy-base.packages:4-5; test/shell.d/app-search-test.sh l.40
merged-from: 60:aether-theme-from-wallpaper; 12:aether-app-launches

### background-picker-select-and-cancel   [VM-OK]
description: The wallpaper picker — reached from Style → Background with the mouse or with Super+Ctrl+Space — shows the current theme's backgrounds with the current one highlighted, cancels with Escape or a scrim click without change, applies a keyboard or mouse choice live, and follows the theme.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `orig=$(readlink -f ~/.local/state/omarchy/current/background); omarchy-theme-bg-current`. Note the name (fresh disk: `Winding Road`).
  * Press Super+Space, click `Style`, click `Background` with the mouse. Do not use the keyboard.
  ** Within 30 s a fullscreen dimmed carousel of the theme's 8 unlabelled wallpaper thumbnails (Tokyo Night) opens with the current one highlighted/centred; there is no filter. Thumbnails are generated on first open.
  * Unhappy paths: press Escape — within 15 s the carousel closes and the wallpaper is unchanged. Press Super+Ctrl+Space, Right once, then click the dark scrim far from the carousel — unchanged.
  * Press Super+Ctrl+Space, press Right (or Down if there is one row) to move the highlight, then Enter. The carousel closes and the wallpaper changes to that image; `omarchy-theme-bg-current` prints its name.
  * Press Super+Space → `Style` → `Background`; click a side slice with the mouse (it slides into the centre), then click the centred image. The wallpaper changes again.
  ** If the theme has a single background nothing can change; exercise the cancel paths and report it.
  * Type `omarchy-theme-set gruvbox`; press Super+Ctrl+Space: the carousel now has Gruvbox's 6 images. Escape. Type `omarchy-theme-set tokyo-night`.
  * Restore: type `omarchy-theme-bg-set "$orig"` — the original wallpaper is back and `omarchy-theme-bg-current` prints the first name. Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * This picker does not filter on typing; use arrows and Enter, or click a tile with the mouse. Super+Ctrl+Space is `<M-C-SPACE>`.
  * Use ./client-with-image after each click to see which slice is centred; double-check the mouse position before clicking menu rows.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Menu screenshot on Style → Background; the carousel with a highlighted current tile; the unchanged wallpaper after Escape and after the scrim click; the wallpaper after the keyboard pick with its name in the terminal; the wallpaper after the mouse pick; the 6-tile Gruvbox carousel; the original restored
  ** The menu path was clicked with the mouse, not typed
  * If unsuccessful
  ** The menu entry or hotkey doing nothing, a carousel without thumbnails after 30 s, Escape or the scrim click applying a change, or Enter/click not applying one
covers: omarchy-menu.jsonc style.background; default/hypr/bindings/utilities.lua:17; bin/omarchy-menu (toggle background); bin/omarchy-theme-bg-switcher; bin/omarchy-theme-bg-set; bin/omarchy-theme-bg-next; bin/omarchy-menu-images; shell/plugins/background/Background.qml; shell/plugins/image-picker/ImagePicker.qml (cancel, slice MouseArea select/apply); test/acceptance.d/shell-surfaces-test.sh (background selector); manual/06:7; manual/07:175-178
merged-from: 32:background-picker-select-and-cancel; 10:background-picker-and-cycle; 21:background-switcher-hotkey-and-menu; 31:menu-background-switcher-apply-and-cancel

### background-desktop-double-click-pickers   [VM-OK]
description: Double-clicking the bare desktop opens the background picker (left button) or the theme picker (right button), and Escape leaves both without changes.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Make sure no window covers the wallpaper: close any open window with Super+W (or switch to an empty workspace with Super+9).
  * Double-click the left mouse button on the empty wallpaper area. The fullscreen background picker opens (current tile highlighted).
  * Press Escape; the desktop returns unchanged.
  * Double-click the right mouse button on the empty wallpaper area. The theme picker opens (tiles are whole-theme previews with names).
  * Press Escape; the desktop returns unchanged.
  * Open a terminal with Super+Enter and type `omarchy-theme-bg-current; cat ~/.local/state/omarchy/current/theme.name` — the same values as before the clicks (nothing applied). Close it with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Use `mouse double-click --x 0.5 --y 0.6 --button left|right`. Single clicks do nothing on the wallpaper.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the background picker after the left double-click and of the theme picker after the right double-click, and the untouched desktop after each Escape; the unchanged names
  * If unsuccessful
  ** Nothing opening on double-click, the wrong picker, or a theme/background silently applied
covers: shell/plugins/background/Background.qml (MouseArea onDoubleClicked, openSelector/openThemeSwitcher)
merged-from: 32:background-desktop-double-click-pickers

### background-picker-filter-and-empty-result   [VM-OK]
description: Typing in a filterable image picker narrows the carousel, moves the selection to the first match when the current image is hidden, shows an empty carousel with no crash for a non-matching filter, and Backspace clears it. Reviewer 51 (shell `image-picker-test.sh`) asserts this on the background picker; reviewers 21/31 say only the theme picker is launched filterable — the driver tries the background picker first and, if typing does nothing there, runs the same steps on the theme picker and reports which one filtered.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Ctrl+Space — the carousel opens with the current theme's wallpapers, the current one selected/centred; screenshot and note its label if one is shown (labels are file names title-cased, `nord_river` → `Nord River`).
  * Type the first three letters of a different image's name (Tokyo Night: `qua` for Quattro).
  ** If the query appears and the carousel narrows with the selection jumping to the first match, continue here. If nothing changes, press Escape, open the theme picker with Super+Shift+Ctrl+Space and type `nor` instead — continue there and report that the background picker did not filter.
  * Press Backspace until the query is empty, then type `zzqq` — no images are shown, the overlay stays open, no crash; screenshot.
  * Press Backspace until empty — the full carousel returns with the original selection.
  * Press Escape (twice if a query is still typed: the first Escape only clears the filter). The overlay closes; open a terminal with Super+Enter and type `omarchy-theme-current; omarchy-theme-bg-current` — unchanged from the start. Close it with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Filtering is case-insensitive; the selected image is the enlarged/centred one; Right and Left move the selection.
  * Do not press Enter in either picker; applying is covered by `background-picker-select-and-cancel` and `theme-switch-menu-and-hotkey`.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Filtered carousel with the moved selection (and which picker it was); the empty carousel for `zzqq`; the full carousel after clearing; the unchanged theme and wallpaper names
  * If unsuccessful
  ** The selection staying on a hidden image, a crash on empty results, or a change applied by Escape; `./client get-serial`
covers: test/shell.d/image-picker-test.sh; shell/plugins/image-picker; manual/39-backgrounds.md
merged-from: 51:background-picker-filter

### background-picker-thumbnails-cache   [VM-OK]
description: The background picker shows one thumbnail per background of the current theme, caches them under the user's cache directory with rows/signature files and no leftover locks, and reopens instantly from that cache.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `rm -rf ~/.cache/omarchy/image-selector; t=$(cat ~/.local/state/omarchy/current/theme.name); ls /usr/share/omarchy/themes/$t/backgrounds/ ~/.config/omarchy/backgrounds/$t/ 2>/dev/null | wc -l` → note the count of backgrounds (Tokyo Night: 8).
  * Press Super+Space → `Style` → `Background`. Thumbnails appear (they may fill in over a second or two; allow 30 s); their number matches the count. Press Escape.
  * Type `ls ~/.cache/omarchy/image-selector/ | grep -c '\.jpg$'` → equals the count; `ls ~/.cache/omarchy/image-selector/ | grep -E '\.(rows|signature)$'` → a rows and a signature file exist; `ls -d ~/.cache/omarchy/image-selector/*.lock 2>&1` → none left.
  * Press Super+Space → `Style` → `Background` again → thumbnails appear immediately. Select a different background than the current with the arrows and Enter; the desktop changes. Reopen and select the original one back.
  * Close the terminal with Super+W; the desktop is as found.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * A leftover `.lock` directory would mean a generator died mid-way; the next open recovers it after ten minutes by contract, so report it if seen.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the picker with all thumbnails, the cache listing with the matching `.jpg` count plus rows/signature files and no locks, and the background changing and restoring
  * If unsuccessful
  ** Screenshot of blank tiles, a mismatched count, or leftover lock directories; output of `omarchy-version`
covers: bin/omarchy-menu-images; shell/plugins/image-picker/list.sh; bin/omarchy-theme-bg-next; test/shell.d/menu-images-test.sh; test/shell.d/video-background-test.sh; manual/39-backgrounds.md
merged-from: 52:background-picker-thumbnails-cache

### background-next-cycles-and-set-rejects-bad-path   [VM-OK]
description: `omarchy-theme-bg-next` steps through the theme's backgrounds in alphabetical order with a wipe transition, reports each by name and wraps around to the first; `omarchy-theme-bg-set` refuses a missing file or no argument without touching the wallpaper, and a path that exists but is not an image leaves the shown wallpaper intact.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `ls ~/.local/state/omarchy/current/theme/backgrounds/; omarchy-theme-bg-current; orig=$(readlink -f ~/.local/state/omarchy/current/background)`. Count the files (N; Tokyo Night: 8) and note the current name (fresh disk: `Winding Road`).
  * Type `for i in $(seq 8); do omarchy-theme-bg-next; sleep 2; omarchy-theme-bg-current; done` (use N instead of 8 if it differs) and screenshot every ~2 s while it runs.
  ** Names print in order: `Quattro`, `Swirl Buck`, `Sunset Lake`, `Omakub`, `Oma Cityscape`, `Oma`, `Omarchy`, then `Winding Road` again (wrap-around); the wallpaper changes each time (a diagonal wipe if you are quick) and each printed name is the file's humanised name (`2-swirl-buck.webp` → `Swirl Buck`).
  * Unhappy paths: type `omarchy-theme-bg-set /tmp/does-not-exist.png; echo "exit=$?"` → `File does not exist: /tmp/does-not-exist.png`, `exit=1`; the wallpaper is unchanged.
  * Type `omarchy-theme-bg-set; echo "exit=$?"` → `Usage: omarchy-theme-bg-set <path-to-media>`, `exit=1`.
  * Type `omarchy-theme-bg-set /etc/hostname; echo "exit=$?"` → `exit=0`; the visible wallpaper stays as it was (the shell keeps the last good image) even though the link now points at a text file.
  * Any image, even another theme's: type `omarchy theme bg set /usr/share/omarchy/themes/nord/backgrounds/1-city-view.webp` → the wallpaper becomes the Nord city view while the bar stays Tokyo Night navy; `readlink ~/.local/state/omarchy/current/background` matches. Type `omarchy-theme-bg-next; omarchy-theme-bg-current` → `Winding Road` (the first, because the Nord file is not in the theme's list).
  * Type `omarchy-theme-bg-set "$orig"` — the wallpaper is confirmed/redrawn from the original file and `omarchy-theme-bg-current` prints the starting name. Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * There is no hotkey for "next background"; the CLI is the only way to cycle. The terminal covers part of the wallpaper; compare the strips beside it.
  * Do not restart the shell while the link points at /etc/hostname; that would render a black desktop (recover with the restore step and report if it happens). If N is 1, report `N=1` and verify only that one `omarchy-theme-bg-next` keeps the same name.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Terminal listing with N files and N+1 names advancing one file per call and returning to the first, with a visibly different wallpaper after each call; both error messages with `exit=1` and `exit=0` for the text file; the wallpaper identical after all three bad commands; the Nord city view under a navy bar and `Winding Road` after the next call; the original name at the end
  * If unsuccessful
  ** The name advancing while the wallpaper does not, the notification `No background was found for theme`, a black/blank desktop after the bad file, the bar disappearing, or the restore failing; `ls ~/.local/state/omarchy/current/theme/backgrounds/`; `./client get-serial`
covers: bin/omarchy-theme-bg-next (index -1 path); bin/omarchy-theme-bg-set (checks; ln + `omarchy-shell background set`); bin/omarchy-theme-bg-current; themes/tokyo-night/backgrounds; shell/plugins/background/Background.qml (IpcHandler set, transitionBackground, reveal; image that never becomes ready); manual/39-backgrounds.md
merged-from: 32:background-next-cycles-in-order; 21:background-next-cli; 32:background-set-rejects-bad-path; 12:background-cli-set-next-reject; 21:background-set-cli-and-rejects-missing

### background-user-folder-joins-picker-and-cycle   [VM-OK]
description: Install → Style → Background opens the theme's personal wallpaper folder in Files; images placed there appear in the picker and the next-cycle without a restart, can be applied, survive theme switches, and drop out again when removed — the manual's way to add your own wallpapers.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `T=$(cat ~/.local/state/omarchy/current/theme.name); echo $T; ls ~/.config/omarchy/backgrounds/ 2>&1` (fresh disk: `tokyo-night`, no folder yet).
  * Press Super+Space → `Install` → `Style` → `Background`. Files (Nautilus, possibly oversized under GDK_SCALE=2, a few seconds to appear) opens on an empty folder whose path bar ends in `backgrounds › tokyo-night`. In the terminal `ls -d ~/.config/omarchy/backgrounds/$T` → the folder now exists.
  * Type `cp /usr/share/omarchy/themes/ristretto/backgrounds/2-coffee-beans.jpg ~/.config/omarchy/backgrounds/$T/ && magick -size 1280x800 xc:'#ff0000' ~/.config/omarchy/backgrounds/$T/zz-solid-red.png && ls ~/.config/omarchy/backgrounds/$T`. Both files appear in Files.
  * Press Super+Ctrl+Space: the carousel now has 10 thumbnails (8 + 2) including the coffee beans and a solid red one (last, sorted). Select the red one with the arrows or the mouse and press Enter.
  ** The desktop wallpaper turns solid red; `readlink ~/.local/state/omarchy/current/background` → …/backgrounds/tokyo-night/zz-solid-red.png; `omarchy theme bg current` → `Zz Solid Red`.
  * Type `omarchy-theme-set gruvbox && omarchy-theme-set tokyo-night`; press Super+Ctrl+Space: still 10 tiles (user images survive theme switches). Escape. Type `omarchy-theme-bg-next` repeatedly (screenshot each) until `readlink ~/.local/state/omarchy/current/background` shows `2-coffee-beans.jpg` — the user folder is part of the cycle.
  * Restore: type `rm ~/.config/omarchy/backgrounds/$T/2-coffee-beans.jpg ~/.config/omarchy/backgrounds/$T/zz-solid-red.png && omarchy-theme-bg-next` → `readlink` shows a theme path and the wallpaper is a theme image; press Super+Ctrl+Space: 8 tiles, no red or coffee thumbnail. Escape. Close Files (Super+W on it) and the terminal.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Files may open behind the menu; press Super+Space to close the menu first. The picker may not filter on typing; use arrow keys or click the thumbnail.
  * The user folder sorts before the theme folder, so the copies are reached right after the last theme background.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Files at the folder; the 10-tile carousel with the red and coffee thumbnails; the red desktop with the readlink and `Zz Solid Red`; still 10 tiles after the theme round trip; the coffee-bean wallpaper reached through bg-next; the 8-tile carousel after removal
  * If unsuccessful
  ** The carousel without the new files, the wallpaper unchanged, or the copies never reached by the cycle; `ls -la ~/.config/omarchy/backgrounds/$T/`; `./client get-serial`
covers: bin/omarchy-theme-bg-install; omarchy-menu.jsonc install.style.background; bin/omarchy-theme-bg-switcher (user dir); bin/omarchy-theme-bg-cache; bin/omarchy-theme-bg-set; bin/omarchy-theme-bg-current; bin/omarchy-theme-bg-next (USER_BACKGROUNDS_PATH); bin/omarchy-menu-images (picker dirs); shell/plugins/background/Background.qml; default/hypr/bindings/utilities.lua:17; manual/39-backgrounds.md
merged-from: 21:background-user-folder-install; 12:background-add-custom-image; 32:background-user-folder-joins-cycle

### background-video-wallpaper   [VM-PARTIAL]
description: A video file in the theme's background folder appears in the picker, plays as the wallpaper (software decoded, looping), shows darkened on the lock screen, is part of the next-cycle, and switching themes away and back does not crash the shell. No shipped theme has a video so a tiny clip is generated with ffmpeg; skipped: audio, GPU decode, the power-saver pause.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `command -v ffmpeg || echo NO-FFMPEG`.
  ** If NO-FFMPEG, record it and stop: the clip cannot be generated in the guest (do not install anything).
  * Type `theme=$(cat ~/.local/state/omarchy/current/theme.name); mkdir -p ~/.config/omarchy/backgrounds/$theme; orig=$(readlink -f ~/.local/state/omarchy/current/background); ffmpeg -y -loglevel error -f lavfi -i testsrc=duration=6:size=640x360:rate=10 -pix_fmt yuv420p ~/.config/omarchy/backgrounds/$theme/9-test.mp4; echo "exit=$?"` → `exit=0`.
  * Press Super+Ctrl+Space (or Super+Space → `Style` → `Background`): a thumbnail for 9-test.mp4 is present and shows a frame of the test pattern, not a blank tile; select it (or type `omarchy-theme-bg-set ~/.config/omarchy/backgrounds/$theme/9-test.mp4`).
  ** The wallpaper shows the moving SMPTE-style test pattern with a running counter. Take three screenshots two seconds apart; the counter digits must differ (it is playing/looping). `ls ~/.cache/omarchy/image-selector/*.jpg | wc -l` → at least one thumbnail was cached.
  * Press Super+Ctrl+L. Screenshot within 3 s: the lock screen shows the video darkened (not blurred) with the box on top. Wait 7 s: the screen is black. Move the mouse: the lock returns. Type `prime`, Enter.
  * Type `omarchy-theme-bg-current` → `Test`. Type `omarchy-theme-bg-next` twice: the video is part of the cycle (`readlink ~/.local/state/omarchy/current/background` shows `9-test.mp4` at some point).
  * Press Super+F on the terminal (fullscreen), wait five seconds, press Super+F again: no crash, and two screenshots five seconds apart after un-fullscreening differ again (playback resumed; the pause while covered cannot be proven from screenshots). Type `omarchy-theme-set nord` (image wallpaper, video stops) and then `omarchy-theme-set tokyo-night`.
  * Restore: type `omarchy-theme-bg-set "$orig"; rm ~/.config/omarchy/backgrounds/$theme/9-test.mp4`; close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Playback is CPU decoded on 2 vCPU; a slightly choppy pattern is fine, a frozen pattern for > 3 s or a black wallpaper is not. If the shell becomes unresponsive, report it.
  * Skipped here: sound (no audio device), GPU decode, the power-saver pause.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The picker thumbnail showing a frame of the pattern and the cache count; three desktop screenshots with different counter values; the lock screen with the darkened video, black after 7 s, the desktop after unlock; `Test` and the mp4 in the cycle; differing frames after un-fullscreening; Nord then Tokyo Night image wallpapers; the original restored
  * If unsuccessful
  ** A blank picker tile, a black/static desktop after setting the mp4, the shell crashing, the file missing from the picker, or the lock falling back to black/no background; `journalctl --user -n 60 | sudo tee /dev/ttyS0` and `./client get-serial`; `omarchy-version`
covers: shell/Ui/BackgroundMedia.qml; shell/Ui/BackgroundVideo.qml; shell/plugins/background/Background.qml (video path, playbackEnabled); shell/plugins/lock/LockView.qml (video darken); lock/Service.qml (monitorDpmsTimer); bin/omarchy-theme-bg-next (video extensions); bin/omarchy-theme-bg-set (video); bin/omarchy-theme-set (is_video_path, no snapshot); bin/omarchy-theme-bg-switcher; bin/omarchy-menu-images; shell/plugins/image-picker/list.sh; test/shell.d/video-background-test.sh; test/shell.d/menu-images-test.sh; manual/39-backgrounds.md (Backgrounds can be videos)
merged-from: 32:background-video-wallpaper; 21:background-video; 12:background-video-loop; 52:video-background-plays-and-pauses-on-lock

### owe-aur-install-video-wallpaper   [VM-PARTIAL] [NET] [SLOW]
description: owe, the org wallpaper engine, is AUR-only: the README's `omarchy pkg add owe` fails, an AUR build installs it (3–6 min on 2 vCPU), and `owe set` puts a generated video behind the desktop with software rendering, pauses/resumes and rejects a bad path; the stock background is restored and the session ends with `stop`.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy pkg add owe; echo "exit=$?"` → `error: target not found: owe`, `exit=1` — owe is AUR-only and the README's command cannot work (03-INTENDED-BEHAVIOUR #23, docs DEFECT in the owe repo).
  * Type `yay -S --noconfirm owe` (password `prime` when asked). yay fetches the PKGBUILD, installs build deps and compiles; several minutes; ends without errors.
  * Type `ffmpeg -y -f lavfi -i testsrc=duration=8:size=1280x720:rate=30 -pix_fmt yuv420p ~/Videos/loop.mp4`, then `owe status`; if it says the daemon is not running, type `systemctl --user start owed 2>/dev/null || (owed &>/tmp/owed.log &)` and `owe status` again → status JSON with renderer liveness.
  * Type `owe set ~/Videos/loop.mp4`; take two screenshots 2 seconds apart: the desktop background is the moving test pattern and the two differ.
  * Type `owe pause`; two screenshots 2 seconds apart are identical (frozen). Type `owe resume`.
  * Unhappy path: type `owe set /nonexistent/file.mp4; echo "exit=$?"` → rejected with an error and a non-zero exit; the wallpaper keeps playing.
  * Type `owe shutdown`, then Super+Space → `Style` → `Background` and pick any background: the stock still background is back. Close the terminal and end the session with `stop` so the AUR install does not persist.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The compile on 2 vCPU can take 3–6 minutes; screenshot every ~30 s. If yay is still building at the 7-minute mark, report the elapsed time and stop.
  * No GPU: choppy playback via llvmpipe is acceptable; a black background or a crashed `owe-render` is not — capture `cat /tmp/owed.log | sudo tee /dev/ttyS0`.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of `omarchy pkg add owe` failing and of yay finishing; two screenshots showing the background animating, two showing it paused; the rejected bad path; the stock background restored
  * If unsuccessful
  ** Serial capture of the build tail or of /tmp/owed.log; `owe status` output
covers: owe README "Install", "Quick start", "CLI reference"; default/omarchy/omarchy-menu.jsonc "install.aur"; bin/omarchy-pkg-aur-install
merged-from: 60:owe-aur-install-video-wallpaper

### font-set-menu-and-cli   [VM-OK]
description: Style → Font lists the installed monospace fonts with the current one marked and applies the one clicked; `omarchy font set` does the same from the CLI for the bar and new terminals, and refuses a font that is not installed.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy font current` → `JetBrainsMono Nerd Font`; `omarchy font list` → a short list including `Liberation Mono`. Leave the terminal visible.
  * Press Super+Space → `Style` → `Font`. A submenu lists the fonts with exactly one row marked ✓ current: `JetBrainsMono Nerd Font`. Click `Liberation Mono` with the mouse.
  ** The bar restarts and its clock/text is now Liberation Mono; a toast `You must restart Foot to see font change` appears. This terminal keeps the old font.
  * Open a new terminal with Super+Enter and type `ls -la`; its letterforms differ from the first terminal's (compare side by side).
  * Press Super+Space → `Style` → `Font` again: the ✓ is now on `Liberation Mono`. Escape.
  * Type `omarchy font current` → `Liberation Mono`; `grep '^font=' ~/.config/foot/foot.ini` → `font=Liberation Mono:size=9`; `grep -c 'Liberation Mono' ~/.config/fontconfig/fonts.conf` → `1`.
  * Unhappy paths: type `omarchy font set "Comic Sans"; echo "exit=$?"` → `Font 'Comic Sans' not found.`, `exit=1`; the bar does not restart and `omarchy font current` is unchanged. Type `omarchy font set; echo "exit=$?"` → usage, `exit=1`.
  * Type `omarchy font set "JetBrainsMono Nerd Font"`; the bar returns to the Nerd Font and a new terminal shows the Nerd Font prompt glyphs. Press Super+Space → `Style` → `Font`: the ✓ is back on JetBrainsMono. Escape; close the terminals with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Font differences are subtle: compare bar digits and the two terminals' `ls -la` output at full resolution. Prompt icons may still render through fontconfig fallback in the Liberation window; that is not a failure.
  * The list is regenerated on every open, so a font that failed to apply simply keeps the ✓ where it was. The stock current font is JetBrainsMono Nerd Font (`fc-match monospace`); reviewer 31 expected CaskaydiaMono — that is only true after `font-install-nerd-font-from-menu`.
  * A plain (non-Nerd) font such as Liberation Mono shows missing-glyph boxes for the bar's icons while selected — expected, and part of why the manual recommends Nerd Fonts; the boxes must vanish after the restore.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The font list; the submenu with the ✓ on JetBrainsMono, then on Liberation Mono; the restart-foot toast; the bar in Liberation Mono; two terminals side by side in different fonts; `font current`, the foot.ini and fonts.conf lines; the two rejections with `exit=1`; the restored bar and ✓
  * If unsuccessful
  ** `fc-match monospace` output, `cat ~/.config/fontconfig/fonts.conf`, the bar screenshot, an empty submenu or a ✓ that did not move; `./client get-serial`
covers: bin/omarchy-font-list; bin/omarchy-font-current; bin/omarchy-font-set; default/fontconfig/conf.avail/50-omarchy.conf; config/foot/foot.ini; shell/plugins/menu/Menu.qml (providers.fonts, mergeProviderRows, invalidateVolatileProvider); omarchy-menu.jsonc style.font; manual/38-fonts.md
merged-from: 21:font-list-current-and-set-cli; 21:font-set-menu; 31:menu-font-provider-switch-and-restore; 12:font-cli-current-list-set-reject

### font-install-nerd-font-from-menu   [VM-OK] [NET]
description: Install → Style → Font → Cascadia Mono downloads the Nerd Font package (a few MB) and switches the bar and new terminals to it in one go; Style → Font then lists and marks it, and the installer CLI refuses a call without arguments. The click path the Fonts chapter describes.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `echo The quick brown fox 0O1lI`; leave it open at one side. Press Super+Space → `Style` → `Font`: `JetBrainsMono Nerd Font` is marked current and CaskaydiaMono is absent. Escape.
  * Press Super+Space → `Install` → `Style` → `Font` → `Cascadia Mono` using the mouse.
  ** Floating terminal: the logo, `Installing Cascadia Mono...`, a sudo prompt (type `prime`), pacman installs `ttf-cascadia-mono-nerd` (a few MB, up to 1–2 min; poll with screenshots), a 2 s pause, the bar flickers as the shell restarts, a toast `You must restart Foot to see font change`, then `● Done! Press any key to close...`. Press a key.
  * The terminal left open keeps its old typeface (foot needs a new window for a font change). Open a new terminal with Super+Enter and type `echo The quick brown fox 0O1lI`: the same text renders in rounder Cascadia letters. Type `omarchy font current` → `CaskaydiaMono Nerd Font`; `fc-list | grep -ci caskaydia` → a number ≥ 1; `grep '^font=' ~/.config/foot/foot.ini` → `CaskaydiaMono Nerd Font:size=9`.
  * Press Super+Space → `Style` → `Font`: `CaskaydiaMono Nerd Font` is listed and marked current. Escape. The bar glyphs are intact (Nerd Font variant).
  * Unhappy path: type `omarchy-install-font; echo "exit=$?"` → `Usage: omarchy-install-font <display-name> <package> <family>`, `exit=1`.
  * Restore: Super+Space → `Style` → `Font` → `JetBrainsMono Nerd Font` (the shell restarts); `omarchy font current` → `JetBrainsMono Nerd Font`. Then `omarchy pkg drop ttf-cascadia-mono-nerd` (password `prime`) — or end the session with `stop`, since the package alters the disk.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Compare a before/after screenshot of the same text in the two terminals; the bar and menu font change too.
  * A mirror failure in pacman is a NET failure, not an Omarchy one; capture the error text either way.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The Font submenu before (Cascadia absent) and after (present and current); the floating terminal ending Done and the restart-foot toast; the identical text in two typefaces side by side; `omarchy font current`, the fc-list count and the foot.ini line; the usage line with `exit=1`; the restored state
  * If unsuccessful
  ** The floating terminal's `Failed (exit code N)!` text or `Font 'CaskaydiaMono Nerd Font' not found.`, pacman/sudo error text, a bar with broken glyphs, `./client get-serial`
covers: bin/omarchy-install-font; bin/omarchy-font-set; omarchy-menu.jsonc install.style.font.cascadia, style.font; manual/38-fonts.md (Install → Style → Font)
merged-from: 21:font-install-nerd-font; 12:font-install-cascadia-from-menu; 23:install-font-cascadia-menu

### font-set-and-text-size-edit-kitty-conf   [VM-OK]
description: `omarchy display text-size` and `omarchy font set` edit kitty.conf with single overrides (never duplicated, never re-adding the theme include) and `reset` restores the 9 pt default, even with no kitty config present.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `cp ~/.config/kitty/kitty.conf /tmp/kitty.orig 2>/dev/null; rm -f ~/.config/kitty/kitty.conf; omarchy display text-size` — the output contains `terminal font: 9 pt` even with no config.
  * Type `omarchy display text-size 16; grep -x 'font_size 12.0' ~/.config/kitty/kitty.conf` — present; the desktop text visibly grows.
  * Type `omarchy display text-size 18; grep -c '^font_size ' ~/.config/kitty/kitty.conf` → `1` (updated, not duplicated).
  * Type `omarchy font set 'Liberation Mono'; omarchy font set 'JetBrainsMono Nerd Font'; grep -c '^font_family ' ~/.config/kitty/kitty.conf; grep -c '^include ' ~/.config/kitty/kitty.conf` → `1` and `0`.
  * Type `omarchy display text-size reset; grep -x 'font_size 9.0' ~/.config/kitty/kitty.conf` — present; the desktop text is back to normal.
  * Type `cp /tmp/kitty.orig ~/.config/kitty/kitty.conf 2>/dev/null || rm ~/.config/kitty/kitty.conf; rm -f /tmp/kitty.orig` — stock again. Close the terminal with Super+W.
  ** The text-size command scales the whole desktop; the larger UI after `16`/`18` is expected.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * kitty is not installed on the stock disk (foot is); the file is still written. Both fonts named here are installed on the stock disk.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** `9 pt`; `font_size 12.0`; single `font_size`/`font_family` lines; no include; `9.0` after reset; the UI size visibly changing and returning
  * If unsuccessful
  ** Duplicated keys, an `include` line added, or a report that does not read `9 pt`
covers: test/shell.d/kitty-config-test.sh (font/text-size half); bin/omarchy-display-text-size; bin/omarchy-font-set; manual/38-fonts.md
merged-from: 51:kitty-font-size-controls

### fontconfig-defaults-and-icon-font-glyphs   [VM-OK]
description: Generic font families resolve to Omarchy's choices (JetBrainsMono for monospace, Liberation for sans/serif/system-ui, Noto Naskh for Arabic) with emoji fallback, and the Omarchy icon font renders real brand marks — in the terminal and on the menu rows that use it — not empty boxes.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `for f in monospace sans-serif serif system-ui; do fc-match $f; done; fc-match :lang=ar` → `JetBrainsMono Nerd Font`, `Liberation Sans`, `Liberation Serif`, `Liberation Sans`, `Noto Naskh Arabic`.
  * Type `printf '\ue900 \ue902 \ue90e \U0001F604 \u0645\u0631\u062d\u0628\u0627 \u05e9\u05dc\u05d5\u05dd\n'` → three icon glyphs (not boxes), a coloured emoji, legible Arabic and Hebrew.
  * Press Super+Shift+Enter (Chromium; click **Wait** on a "not responding" dialog) and open `data:text/html,<p style="font-family:system-ui">system-ui Sans</p><p style="font-family:monospace">monospace 0O1l</p><p>&#x1F604; &#x645;&#x631;&#x62D;&#x628;&#x627;</p>` → first line in a sans face, second monospace, a coloured emoji, legible Arabic. Press Super+W.
  * Press Super+Space → `Setup` → `Defaults` → `Agent`. The rows (Codex, Cursor CLI, Grok, Hermes, omp, OpenClaw, OpenCode, Ori, Pi…) each show a distinct monochrome brand mark in the theme foreground colour. Press Down once: the highlighted row's mark takes the selection colour.
  * Press Escape twice, then Super+Space → `Install` → `AI`: the same marks appear beside Claude Desktop, ChatGPT Desktop, Hermes Desktop, LM Studio, Ollama, Perplexity, T3 Code. Escape.
  * Press Ctrl+D in the terminal; the desktop is as before.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Boxes with hex digits in the terminal line mean a missing font; report which glyph. A hollow rectangle (tofu) or a blank where a menu icon should be is the failure this test looks for.
  * Type `<` and `>` in the data URL as `<LT>`/`<GT>`; the emoji and Arabic are given as escapes/entities because the driver can only type ASCII.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of the fc-match lines, the terminal glyph line, the Chromium rendering, the Agent submenu with distinct marks and the highlighted row recoloured, and the Install → AI submenu with marks
  * If unsuccessful
  ** Screenshot of DejaVu/Noto Sans picked for monospace/sans, boxes for the icon glyphs, Nastaliq for plain Arabic, or a submenu with tofu boxes
covers: default/fontconfig/conf.avail/50-omarchy.conf; default/fonts/omarchy/* (omarchy.ttf); docs/file-layout.md; omarchy-menu.jsonc setup.default.agent.* / install.ai.* (iconFont); agents/skills/icon-font.md
merged-from: 41:fontconfig-defaults; 21:menu-icon-font-glyphs

### branding-about-text-edit-and-reset   [VM-OK]
description: About shows system info beside the Omarchy logo with a light sheen sweeping across it and closes on any key; Style → About → Edit Text replaces the logo with the user's text (About pops up re-fitted after each change) and Restore Default brings the stock logo and size back; the CLI refuses an unknown subcommand.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Space and click `About` with the mouse. A floating terminal opens with the block-art Omarchy logo on the left and system info (OS `Omarchy`, kernel, uptime, packages, shell, resolution, theme…) on the right.
  ** Take three screenshots about one second apart: a bright diagonal band (green glint) moves across the logo while the info text stays put. Press any key; the window closes.
  * Press Super+Space → `Style` → `About` → `Edit Text`. Neovim opens `~/.config/omarchy/branding/about.txt`.
  * Replace the content: type `ggdG`, then `i`, type `HELLO` Enter `OLIGARCHY` Enter `!!!`, press Escape, type `:wq` and Enter.
  ** About opens automatically showing HELLO / OLIGARCHY / !!! where the logo was, the window re-fitted smaller. Screenshot twice a few seconds apart (the glint applies to single-width text). Press a key to close it.
  * Press Super+Space → `Style` → `About` → `Restore Default`. About opens with the Omarchy block logo again at its original size. Press a key.
  * Open a terminal with Super+Enter and type `diff -q ~/.config/omarchy/branding/about.txt /usr/share/omarchy/icon.txt` → no output (identical).
  * Unhappy path: type `omarchy-branding-about bogus; echo "exit=$?"` → `Usage: omarchy-branding-about <image|text|reset>`, `exit=1`. Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * About closes on any key, so take the screenshot before pressing anything; the window resizes to its content on launch — wait a second. A clipped or scrolling logo is a failure.
  * About relaunches only when the editor exits cleanly; if a different editor opens, use its own save-and-quit.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Three stock About screenshots with the band in different positions; the editor with the custom text; About showing HELLO / OLIGARCHY / !!! re-fitted; About with the restored logo at original size; empty diff; the usage error with `exit=1`
  * If unsuccessful
  ** About not appearing after `:wq`, the art unchanged, or a clipped/absent logo; About screenshot after each step; `./client get-serial`
covers: bin/omarchy-branding-about (text, reset, usage); bin/omarchy-launch-editor; bin/omarchy-launch-about (fit on logo change); bin/omarchy-branding-about-animation; omarchy-menu.jsonc style.about.*, about; $OMARCHY_PATH/icon.txt; test/shell.d/branding-about-animation-test.sh; manual/41-branding.md (About screen)
merged-from: 21:branding-about-text-edit-and-reset; 12:about-branding-edit-and-reset; 22:about-branding-restore-default; 21:branding-about-window

### branding-about-from-image-and-cancel   [VM-OK]
description: Style → About → Set From Image turns a chosen PNG into text art for About; cancelling the file chooser changes nothing, and Restore Default brings the logo back.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Space → `Style` → `About` → `Set From Image`. A file chooser titled `Pick PNG or SVG for About` opens (portal GTK dialog, possibly oversized).
  * Unhappy path: press Escape. Nothing opens; press Super+Space → `About`: the stock logo is unchanged. Press a key.
  * Repeat the menu path; in the chooser press Ctrl+L, type `/usr/share/omarchy/themes/gruvbox/unlock.png`, press Enter.
  ** About opens showing a braille rendering of the Gruvbox unlock logo, no wider than the previous logo area. Press a key to close About.
  * Press Super+Space → `Style` → `About` → `Restore Default`; About shows the stock logo. Press a key. The desktop is as found.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Ctrl+L plus a typed path is the reliable way to pick a file in the portal chooser. About closes on any key — screenshot first.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The chooser; unchanged About after cancel; About with the transcoded logo; the restored logo
  * If unsuccessful
  ** In a terminal `omarchy-transcode-ascii /usr/share/omarchy/themes/gruvbox/unlock.png /tmp/x.txt --width 54 --height 26; echo "exit=$?"`
covers: bin/omarchy-branding-about (image); bin/omarchy-file-select; bin/omarchy-transcode-ascii; omarchy-menu.jsonc style.about.image
merged-from: 21:branding-about-from-image

### plymouth-preview-render-and-reject   [VM-OK]
description: `omarchy plymouth preview` composes a 1920×1080 boot-screen mock-up from two colours and a logo and shows it full-screen in imv, and rejects malformed colours, a missing logo or missing arguments — so users can see branding before touching the boot chain.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy plymouth preview '#1d2021' '#ebdbb2' /usr/share/omarchy/default/plymouth/logo.png /tmp/preview.png`.
  ** After a second or two imv opens full-screen: a dark (#1d2021) canvas with the Omarchy logo centred and a password entry box beneath it with a lock icon to its left and four bullets inside, all tinted #ebdbb2. Screenshot, then press `q` to close imv.
  * Type `ls -la /tmp/preview.png; magick identify /tmp/preview.png` → the file exists, `PNG 1920x1080`.
  * Type `omarchy plymouth preview '#004400' '#ffff00' /usr/share/omarchy/themes/gruvbox/unlock.png /tmp/preview2.png` → green canvas, Gruvbox logo, yellow entry box. Press `q`.
  * Unhappy paths: type `omarchy plymouth preview '#zzz' '#ebdbb2' /usr/share/omarchy/default/plymouth/logo.png /tmp/x.png; echo "exit=$?"` → `Invalid background color: #zzz (expected #RRGGBB)`, `exit=1`; `omarchy plymouth preview red '#ffffff' /usr/share/omarchy/themes/gruvbox/unlock.png /tmp/x.png; echo "exit=$?"` → `Invalid background color: red (expected #RRGGBB)`, `exit=1`.
  * Type `omarchy plymouth preview '#000000' '#ffffff' /nope.png /tmp/x.png; echo "exit=$?"` → `Logo file not found: /nope.png`, `exit=1`; `omarchy plymouth preview a b; echo "exit=$?"` → usage, `exit=1`.
  * Clean up: type `rm -f /tmp/preview.png /tmp/preview2.png` and close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * imv is full-screen (-f); take the screenshot before pressing `q`. No sudo is needed anywhere in this test.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots of both imv previews and of `magick identify` reporting 1920x1080; the four refusals with `exit=1`
  * If unsuccessful
  ** The magick/imv error text, `./client get-serial`
covers: bin/omarchy-plymouth-preview; default/plymouth/{bullet,entry,lock}.png; manual/41-branding.md (Boot unlock preview)
merged-from: 12:plymouth-preview-render-and-reject; 21:plymouth-preview-cli

### plymouth-list-current-and-unlock-picker   [VM-OK]
description: Every theme is offered as a boot-screen style, the stock disk reports `default`, and the Style → Unlock picker previews them with names and closes on Escape without starting anything.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy plymouth list | wc -l` → `22`; `omarchy plymouth current` → `default`.
  * Press Super+Space → `Style` → `Unlock`. A labelled grid opens: a `default` tile plus one per theme, each a dark boot-screen mock-up with a logo and password box; `default` is highlighted.
  * Press Escape. No terminal or password prompt appeared; `omarchy plymouth current` still prints `default`. Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * This test needs no sudo at all. `plymouth current` identifies the theme by logo byte-compare, so a custom set with the stock logo also reports `default`.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** `22` and `default` in the terminal; the labelled Unlock grid; `default` again after Escape
  * If unsuccessful
  ** The list output and the picker screenshot, or whatever Escape triggered
covers: bin/omarchy-plymouth-list; bin/omarchy-plymouth-current; bin/omarchy-plymouth-switcher; omarchy-menu.jsonc style.unlock; themes/*/preview-unlock.png
merged-from: 21:plymouth-list-current-and-switcher

### plymouth-set-rejects-bad-input-and-wrong-sudo-password   [VM-OK]
description: The boot-screen setter refuses bad colours, a missing or symlinked logo, running under sudo and an unknown theme — all before asking for a password or touching the installed splash — the Style → Unlock picker passes a hostile theme name as data, and a wrong sudo password in the Unlock flow fails the floating terminal with the Failed banner; the Plymouth and SDDM logos stay byte-identical throughout.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `sudo -k; md5sum /usr/share/plymouth/themes/omarchy/logo.png /usr/share/sddm/themes/omarchy/logo.png` — record both checksums.
  * Type `omarchy plymouth set '#zzzzzz' '#ffffff' /usr/share/omarchy/themes/nord/unlock.png; echo "exit=$?"` → `Invalid background color: #zzzzzz (expected #RRGGBB)`, `exit=1`, no password prompt.
  * Type `omarchy plymouth set '#000000' '#ffffff' /nope.png; echo "exit=$?"` → `Logo file not found: /nope.png`; then `ln -sf /etc/hostname /tmp/link.png; omarchy plymouth set '#000000' '#ffffff' /tmp/link.png; echo "exit=$?"` → `Logo file is a symlink, which is not accepted: /tmp/link.png`, `exit=1`, no sudo prompt.
  * Type `omarchy-plymouth-set-by-theme nope 2>&1 | tail -1` → `Invalid background color:  (expected #RRGGBB)` (the theme has no colours file; note the unhelpful message).
  * Type `sudo omarchy-plymouth-set '#000000' '#ffffff' /usr/share/omarchy/themes/nord/unlock.png; echo "exit=$?"` (this one prompts; type `prime`) → `Error: run omarchy-plymouth-set as your user, not under sudo.`, non-zero. Then type `sudo -k`.
  * Hostile theme name as data: type `mkdir -p "$HOME/.config/omarchy/themes/a';touch \$HOME\/unlock-pwned;'b"`; press Super+Space → `Style` → `Unlock` and select that odd row → the floating terminal runs `omarchy-plymouth-set-by-theme` with the whole name and fails (no `unlock.png`); press a key. Type `ls ~/unlock-pwned 2>&1` → no such file; `rm -rf "$HOME/.config/omarchy/themes/a';touch \$HOME\/unlock-pwned;'b"`.
  * Press Super+Space → `Style` → `Unlock` and click `nord`. At `[sudo] password for prime:` type `wrong` and Enter, three times.
  ** `Sorry, try again.` twice, then `sudo: 3 incorrect password attempts` and `● Failed (exit code 1)! Press any key to close...`. Press a key.
  * In the terminal type `omarchy plymouth current; md5sum /usr/share/plymouth/themes/omarchy/logo.png /usr/share/sddm/themes/omarchy/logo.png` → still `default` and both checksums unchanged; `rm /tmp/link.png`; close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Except for the deliberate `sudo` case and the two Unlock-picker runs, none of these may prompt for a password or start `mkinitcpio`/`limine-mkinitcpio`.
  * The three wrong passwords count toward faillock (deny=10, unlock 120 s, shared with the lock screen and sudo); do not add more wrong passwords in this session. On an old build a file `~/unlock-pwned` appearing is the exact regression the unit test guards — record `omarchy-version`.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Terminal with the five refusals (symlink and root messages verbatim); the hostile-name picker run and `~/unlock-pwned` absent; the floating terminal with the three failures and the Failed banner; `default` and unchanged checksums; no unexpected password prompt on any screenshot
  * If unsuccessful
  ** Any refusal that instead prompted for a password or began rebuilding; a Done banner, a changed `plymouth current` or checksum, or `~/unlock-pwned` existing; `omarchy-version`
covers: bin/omarchy-plymouth-set (argument/logo guards, EUID check, run_root_transaction failure); bin/omarchy-plymouth-set-by-theme; bin/omarchy-plymouth-switcher; bin/omarchy-launch-floating-terminal-with-presentation; bin/omarchy-show-done; omarchy-menu.jsonc style.unlock; test/shell.d/plymouth-set-test.sh; test/shell.d/menu-test.sh; manual/41-branding.md; manual/06-themes.md
merged-from: 21:plymouth-set-rejects-bad-input; 21:plymouth-sudo-wrong-password; 52:unlock-screen-theme-refusals

### plymouth-set-by-theme-reboot-and-reset   [VM-OK] [SLOW]
description: Style → Unlock lets the user pick a theme's unlock image for the Plymouth boot screen (and SDDM): the floating terminal republishes root-owned 0644 assets and rebuilds the initramfs under sudo, the next boot's LUKS passphrase screen shows the themed logo and colours, and `omarchy plymouth reset` (or picking `default`) puts the stock branding back. Two initramfs rebuilds and a reboot make this slow.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy plymouth current; ls -l /usr/share/plymouth/themes/omarchy/ /usr/share/sddm/themes/omarchy/ | sudo tee /dev/ttyS0` → `default`; every file is a regular `-rw-r--r-- root root` file.
  * Press Super+Space → `Style` → `Unlock`. The labelled picker opens with `default` preselected. Unhappy path first: press Escape — the picker closes and no terminal opens.
  * Press Super+Space → `Style` → `Unlock` again and select `gruvbox`.
  ** A floating "Omarchy" terminal runs `omarchy-plymouth-set-by-theme gruvbox`: sudo prompt (type `prime`), the Plymouth theme is recoloured, `limine-mkinitcpio`/`mkinitcpio` regenerates the initramfs (1–4 min on 2 vCPU; keep screenshotting), SDDM colours are updated, `● Done!`. Press the key it names.
  * Type `omarchy plymouth current` → `gruvbox`; `cmp /usr/share/plymouth/themes/omarchy/logo.png /usr/share/omarchy/themes/gruvbox/unlock.png && echo SAME` → `SAME`; `ls -l /usr/share/plymouth/themes/omarchy/logo.png /usr/share/sddm/themes/omarchy/logo.png` → still regular 0644 root files; `grep -c SetBackgroundTopColor /usr/share/plymouth/themes/omarchy/omarchy.script` → `1`; `find /usr/share/plymouth/themes/omarchy /usr/share/sddm/themes/omarchy -name '.*omarchy-new*'` → nothing left behind.
  * Reboot: press Super+Escape (System menu) → `Reboot`. From the moment the firmware screen disappears, screenshot every second: the Plymouth passphrase screen must use the Gruvbox background colour and the Gruvbox unlock logo, not the stock Omarchy logo. Type the LUKS passphrase `prime` blind (early keys are discarded; at most one wrong try) — autologin lands on the desktop with no SDDM step.
  * Open a terminal with Super+Enter and type `omarchy plymouth reset` (password `prime`) → refreshes Plymouth and SDDM (another initramfs rebuild, 1–4 min); `omarchy plymouth current` → `default`; `cmp /usr/share/omarchy/default/plymouth/logo.png /usr/share/plymouth/themes/omarchy/logo.png && echo SAME` → `SAME`.
  ** Menu equivalent: Super+Space → `Style` → `Unlock` → `default` runs `omarchy-plymouth-reset` in a floating terminal and must end `● Done!` even when already default.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The boot splash is brief before the passphrase prompt and is not reliably OCR-able; rely on the logo shape and background colour. `plymouth current` identifies the theme by logo byte-compare.
  * The presentation terminal shows the logo, the output, then `Done` or `Failed`; red `Failed` text is a failure — capture it. If the session budget runs out before the reset, report the state so the disk is discarded (`stop`), never saved.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The Unlock picker and the desktop after Escape; the set terminal ending Done; `gruvbox`, `SAME`, the 0644 root listings, `1` and no temp files; the Gruvbox-branded Plymouth passphrase screen after reboot; the reset terminal and `default`/`SAME` afterwards
  * If unsuccessful
  ** The stock logo still shown at boot, the set/reset terminal failing (initramfs error), a symlink or non-0644 file in the theme directories, leftover `.omarchy-new` files; `./client get-serial`; `omarchy-version`
covers: manual/41-branding.md (Boot unlock); manual/43 (Unlock image); manual/06:70; omarchy-menu.jsonc style.unlock (:106); bin/omarchy-plymouth-switcher; bin/omarchy-plymouth-set-by-theme; bin/omarchy-plymouth-set; bin/omarchy-plymouth-reset; bin/omarchy-plymouth-current; bin/omarchy-plymouth-list; bin/omarchy-refresh-plymouth; bin/omarchy-refresh-sddm; test/shell.d/plymouth-set-test.sh
merged-from: 12:style-unlock-picker-set-reboot-reset; 52:unlock-screen-theme-applies-on-reboot; 10:unlock-style-picker-cancel; 21:plymouth-set-by-theme-and-reboot; 21:plymouth-reset-default-and-reboot

### refresh-config-hyprland-restores-with-backup   [VM-OK]
description: Update → Config → Hyprland rewrites all seven `~/.config/hypr` files from the shipped defaults, reports only the ones it changed with a `.bak.<epoch>` backup and a diff (03-INTENDED-BEHAVIOUR #21: per group, timestamped — the manual's "a .bak file" is imprecise), and Hyprland works again; the CLI `omarchy refresh config <path>` does the same per file, is idempotent, and must refuse paths Omarchy does not ship — including a `..` path, which at HEAD still escapes to `~/default/` (03-INTENDED-BEHAVIOUR #27, known DEFECT).
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `echo 'this is not lua (' >> ~/.config/hypr/bindings.lua && echo '-- probe edit' >> ~/.config/hypr/looknfeel.lua && hyprctl reload`. Hyprland shows a config-error banner or `hyprctl reload` prints an error.
  * Press Super+Space → `Update` → `Config` → `Hyprland`.
  ** The floating terminal prints, for the two changed files only, a red `Replaced /home/prime/.config/hypr/bindings.lua with new Omarchy default.`, `Saved backup as …bindings.lua.bak.<epoch>.`, a green `Changes:` with `> this is not lua (`, and the same block for looknfeel.lua with `-- probe edit`; nothing for the five untouched files; then `● Done!`. Press a key.
  * The error banner is gone; press Super+K — the keybindings list opens; Escape. In the terminal type `ls ~/.config/hypr/` → the seven files plus two `.bak.*`; `tail -1 ~/.config/hypr/bindings.lua.bak.*` → `this is not lua (`; `cmp /usr/share/omarchy/config/hypr/bindings.lua ~/.config/hypr/bindings.lua` → identical; `hyprctl configerrors` → empty.
  * Idempotence: type `omarchy refresh config hypr/bindings.lua; echo "exit=$?"` again → no `Replaced` line, `exit=0` (identical files leave no new backup); `ls ~/.config/hypr/bindings.lua.bak.*` → exactly one. A deleted config is recreated silently: `rm ~/.config/tmux/tmux.conf; omarchy-refresh-config tmux/tmux.conf; ls ~/.config/tmux/` → `tmux.conf` back, no output, no backup.
  * Unhappy paths: type `omarchy-refresh-config hypr/missing.lua; echo "exit=$?"` → `Not a shipped user config: hypr/missing.lua`, `exit=1`; `omarchy-refresh-config; echo "exit=$?"` → the `Usage:` text mentioning `hypr/hyprland.lua`, `exit=1`. Press Super+Space → `Update` → `Config`: a list of shipped config groups is offered; Escape.
  * Path escape: type `omarchy refresh config ../default/bashrc; echo "exit=$?"; ls -l ~/default/bashrc 2>&1`.
  ** Intended: `Not a shipped user config: ../default/bashrc`, `exit=1`, and `ls` reports No such file (nothing written outside ~/.config).
  ** Observed at HEAD: `exit=0` and `~/default/bashrc` exists — record this as the known defect.
  * Clean up: type `rm -rf ~/default ~/.config/hypr/*.bak.*` and close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * If the broken file takes Super+Space down with it, type `omarchy-refresh-hyprland` in the open terminal instead and report that.
  * The `Replaced` lines are red and the `Changes:` header green. `Update → Config` restores groups (all seven `~/.config/hypr` files are rewritten; the untouched ones leave no backup because identical files are not kept); per-file restore is the CLI. The `..` refusal is the intended pass condition; the HEAD copy is the expected failure today.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** The error state; the floating terminal with the two red Replaced/Saved backup blocks and diffs; working Super+K; the directory listing, the backup's last line, identical `cmp`, empty `hyprctl configerrors`; no second Replaced and a single `.bak`; the recreated `tmux.conf` with no backup; the three refusals (`hypr/missing.lua`, no argument, `../default/bashrc`) with `exit=1` and no `~/default/bashrc`
  * If unsuccessful
  ** The `..` path copying with `exit=0` and `ls -l ~/default/bashrc` existing (the known defect, recorded with `omarchy-version`); a stray `.bak` for an unmodified file; the floating terminal output and `hyprctl reload` error text; the marker surviving in the live file, no backup created, or the missing-path case accepted; `ls -la ~/.config/hypr/`
covers: bin/omarchy-refresh-hyprland; bin/omarchy-refresh-config (identical → no backup, recreate deleted); omarchy-menu.jsonc update.config.hyprland (:355-369); test/shell.d/refresh-config-test.sh; manual/42:3-5; manual/42-common-tweaks.md; manual/31-dotfiles.md; AGENTS.md §Refresh Pattern (incl. `..` caveat); default/agents/skills/omarchy/SKILL.md §Troubleshooting, §Reset to Defaults
merged-from: 21:refresh-config-restores-broken-hyprland; 40:hypr-refresh-hyprland-restores-stock-config; 52:refresh-config-backs-up-user-file; 61:agent-skill-refresh-config; 21:refresh-config-cli-guards

### refresh-config-shell-tmux-hyprsunset-restart   [VM-OK]
description: Update → Config → Shell resets the bar to Omarchy defaults (a bottom bar goes back to the top), and → Tmux and → Hyprsunset each restore a user-broken config — every one keeps a timestamped backup and restarts the affected program.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy-bar position bottom` — the bar moves to the bottom of the screen (this also creates `~/.config/omarchy/shell.json`). Then type `echo 'set -g status off # BROKEN' >> ~/.config/tmux/tmux.conf && echo 'garbage' >> ~/.config/hypr/hyprsunset.conf`.
  * Press Super+Space → `Update` → `Config` → `Shell`.
  ** The floating terminal prints `Replaced /home/prime/.config/omarchy/shell.json…`, `Saved backup as …shell.json.bak.<epoch>`, the shell restarts (the bar disappears ~2 s) and comes back at the top; `● Done!`. Press a key.
  * Press Super+Space → `Update` → `Config` → `Tmux`: `Replaced …/tmux/tmux.conf…`, a backup, a diff with `# BROKEN`, `● Done!`. Press a key.
  * Press Super+Space → `Update` → `Config` → `Hyprsunset`: `Replaced …/hypr/hyprsunset.conf…`, a backup, a diff with `garbage`, `● Done!`. Press a key.
  * In the terminal type `ls ~/.config/omarchy/shell.json.bak.* ~/.config/tmux/*.bak.* ~/.config/hypr/hyprsunset.conf.bak.*` → three files; `tmux new -d -s t && tmux kill-session -t t && echo tmux-ok; pgrep -x hyprsunset` → `tmux-ok` and a PID.
  * Type `rm ~/.config/omarchy/shell.json.bak.* ~/.config/tmux/*.bak.* ~/.config/hypr/hyprsunset.conf.bak.*` and close the terminal with Super+W. The bar is on top as found.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Screenshot the bottom bar before the refresh; that is the "before" proof. All three floating terminals close on any key; read the red lines before pressing one.
  * Restarting hyprsunset silently turns nightlight off if it was on — expected.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Bar at the bottom; three floating-terminal screenshots with Replaced/Saved backup and the diff lines; bar at the top; the three backups listed; `tmux-ok` and the hyprsunset PID
  * If unsuccessful
  ** The floating terminal output, a bar that stayed at the bottom, `pgrep -a hyprsunset`
covers: bin/omarchy-refresh-shell; bin/omarchy-refresh-tmux; bin/omarchy-refresh-hyprsunset; bin/omarchy-refresh-config; bin/omarchy-bar; omarchy-menu.jsonc update.config.{shell,tmux,hyprsunset}
merged-from: 21:refresh-shell-resets-bar; 21:refresh-tmux-and-hyprsunset

### refresh-applications-and-chromium-flags   [VM-OK]
description: `omarchy-refresh-applications` puts back the shipped launcher entries a user deleted so they reappear in the Apps menu, and `omarchy-refresh-chromium` restores the Chromium flags file from the default keeping a backup that shows the user's change.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter, press Super+F, and type `rm ~/.local/share/applications/YouTube.desktop`.
  * Press Super+Alt+Space (Apps menu) and type `youtube`: no result. Escape.
  * In the terminal type `omarchy-refresh-applications`; it finishes without an error. Press Super+Alt+Space and type `youtube`: the YouTube web app is listed. Escape.
  * Type `echo '--broken-flag' >> ~/.config/chromium-flags.conf`, then `omarchy-refresh-chromium`.
  ** Output: `Replaced /home/prime/.config/chromium-flags.conf…`, `Saved backup as …chromium-flags.conf.bak.<epoch>`, a diff with `> --broken-flag`, plus lines from re-installing the native messaging hosts; no errors.
  * Type `grep -c broken ~/.config/chromium-flags.conf` → `0`; `rm ~/.config/chromium-flags.conf.bak.*`. Close the terminal with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * The Apps menu may need a second to re-read the desktop database; reopen it if the entry is not there at once.
  * Keep the terminal maximised so the red Replaced lines are readable.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Apps menu without YouTube, then with it; the terminal with Replaced/Saved backup and the diff line; `0`
  * If unsuccessful
  ** The command output and `ls ~/.local/share/applications/`
covers: bin/omarchy-refresh-applications; applications/*.desktop; bin/omarchy-refresh-chromium; bin/omarchy-refresh-config
merged-from: 21:refresh-applications-restores-launchers; 21:refresh-chromium-flags

### bar-position-menu-and-cli   [VM-OK]
description: The bar moves to any screen edge from Style → Menu Bar → Position or `omarchy bar position`, widgets and panels adapt to a vertical bar, an invalid edge, unknown bar option or unknown subcommand are rejected, and `reset`/`defaults` restore the built-in bar.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Space → `Style` → `Menu Bar` → `Position` → `Bottom`. Within 20 s the bar moves to the bottom edge; windows re-tile.
  * Press Super+Return and type `jq .bar.position ~/.config/omarchy/shell.json` → `"bottom"`; then `omarchy bar position left` → `Bar position set to left`; the bar stands as a vertical strip along the left edge with icon-only widgets and a stacked clock (`HH`, a dash, `mm`); the top edge is empty.
  * Press Super+Ctrl+W (the network panel; Super+Ctrl+1 is the same panel by position): it opens beside the left bar, not under the top edge. Press Escape.
  * Press Super+Space → `Style` → `Menu Bar` → `Position` → `Top` (with the bar on the left the menu logo is the topmost icon of the strip and Super+Space still works). The bar returns to the top as a horizontal strip.
  * Unhappy paths: type `omarchy bar position middle; echo "exit=$?"` → `omarchy-bar: position must be top, bottom, left, or right`, `exit=1`; the bar stays on top. `omarchy-bar use nosuch.bar; echo "exit=$?"` → `nosuch.bar is not a known bar option; run 'omarchy plugin list'`, `exit=1`. `omarchy-bar frob; echo "exit=$?"` → `unknown command: frob`, `exit=1`. `omarchy-bar` → usage.
  * Type `omarchy-bar reset` → `Using omarchy.bar as the active bar`; then `omarchy bar defaults` → `Restored the default Omarchy bar`. Press Super+W. The desktop is as found.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Windows re-tile when the bar moves; that is expected. Allow 20 s for a position change.
  * The first `omarchy bar` command creates `~/.config/omarchy/shell.json`; `defaults` restores it.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots with the bar at the bottom and `"bottom"`, at the left (vertical, stacked clock) with the network panel anchored beside it, on top again, and the four rejection messages with `exit=1`; the reset/defaults lines
  * If unsuccessful
  ** Screenshot of the bar in the wrong place or a mis-anchored panel; `cat ~/.config/omarchy/shell.json`
covers: manual/05:85-94; omarchy-menu.jsonc:108-118 (style.bar.position.*); bin/omarchy-bar (cmd_position, cmd_defaults, use, reset); bin/omarchy-shell-config; shell/Ui/KeyboardPanel.qml (cardOrigin for left bars); test/acceptance.d/menu-test.sh
merged-from: 10:bar-position-menu-and-cli; 31:menu-bar-position-and-transparency; 25:bar-position-transparency-reset

### bar-transparency-doubleclick-menu-cli   [VM-OK]
description: Double-clicking empty bar space toggles transparency with the text still readable; Style → Menu Bar → Transparency and `omarchy bar transparent` flip the same setting, and a bad value is rejected.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Press Super+Return so a terminal sits under the bar. Screenshot the bar: a solid background strip.
  * Double-left-click an empty patch of the bar at about x≈0.25, y≈0.01 (between the workspace indicators and the clock, clear of any widget). Within 2 s the bar background turns transparent (the wallpaper/terminal shows through) while the text stays readable. Double-click again: opaque.
  ** Keep the double-click quick; a click-and-hold starts a bar drag instead.
  * Press Super+Space → `Style` → `Menu Bar` → `Transparency`. The bar turns transparent; in the terminal `jq .bar.transparent ~/.config/omarchy/shell.json` → `true`.
  * Type `omarchy bar transparent false` → `Bar transparency set to false`; opaque again. Type `omarchy bar transparent toggle` → `Bar transparency toggled`; transparent.
  * Unhappy path: type `omarchy bar transparent maybe; echo "exit=$?"` → `omarchy-bar: transparent must be true, false, or toggle`, `exit=1`; nothing changes.
  * Type `omarchy bar defaults` → `Restored the default Omarchy bar`; the bar is solid and as found. Press Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Use `./client mouse double-click`; the space between the workspaces and the clock is safe bar background. Compare the strip behind the clock text to judge transparency.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshots: opaque, transparent after the double-click with the wallpaper visible behind the clock, opaque, transparent via the menu with `true`, opaque via CLI, transparent via toggle, the rejection with `exit=1`, and the restored solid bar
  * If unsuccessful
  ** Screenshot of the bar unchanged after the double-click
covers: manual/05:83-91; omarchy-menu.jsonc:110 (style.bar.transparency); bin/omarchy-bar cmd_transparent; shell/plugins/bar/Bar.qml (CenterGestureArea.onDoubleClicked, toggleTransparency, refreshTransparentForeground); test/shell.d/bar-text-color-test.sh
merged-from: 10:bar-transparency-doubleclick-menu-cli; 30:bar-transparency-double-click

### bar-transparent-text-colour-follows-wallpaper   [VM-OK]
description: With a transparent bar the text turns dark over a light wallpaper strip and stays light over a dark one, so the bar is readable on every theme.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * Open a terminal with Super+Enter and type `omarchy-theme-set tokyo-night; omarchy bar transparent true` — after 3 s the bar is see-through with light text; screenshot.
  * Type `omarchy-theme-set flexoki-light` — after 5 s the wallpaper is light and the bar text is dark; screenshot.
  * Type `omarchy-theme-set catppuccin-latte` — after 5 s still dark text on the light strip; screenshot.
  * Type `omarchy-theme-set tokyo-night` — light text again; screenshot.
  * Type `omarchy bar transparent false` — the bar is opaque again: back to stock. Close the terminal with Super+W.
  ** Theme application is asynchronous; if the bar has not recoloured after 5 s, wait 5 s once more.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Judge contrast on the clock digits in the top strip of the screenshot.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Light text on dark; dark text on two light themes; light text on dark again; opaque bar at the end
  * If unsuccessful
  ** A screenshot where the bar text matches the brightness of the strip behind it
covers: test/shell.d/bar-text-color-test.sh; test/shell.d/background-test.sh (async theme apply); bin/omarchy-bar-text-color; manual/05-the-top-bar.md; manual/06-themes.md
merged-from: 51:bar-transparent-text-color-follows-wallpaper

## Not runnable here

### shipped-skill-agent-changes-theme   [VM-NO] [NET]
description: An AI agent running inside the guest, asked to "change the theme to nord", follows the shipped `omarchy` skill and runs `omarchy theme set nord`; asked about a crash, it follows `diagnose-crash`. Not runnable here: no agent is preinstalled (a mise install is 50–200 MB) and every agent needs an API key or login the driver does not have.
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * (Precondition not achievable in this harness) A default agent is installed and logged in: `omarchy default agent opencode` has completed and `opencode` accepts a provider key.
  * Open a terminal with Super+Enter and type `omarchy agent prompt "Change my theme to nord, then confirm the current theme."`.
  * An agent window opens (app-id org.omarchy.agent, working directory ~/Work); its transcript shows it reading the `omarchy` skill and running `omarchy theme set nord` — never editing anything under /usr/share/omarchy. The desktop retints to Nord.
  * Type `sleep 300 & sleep 1; kill -SEGV $!` and click the "Process crashed: sleep" toast → the agent opens with the prepared prompt naming the diagnose-crash skill, runs `coredumpctl info`, reports signal and command line, offers `omarchy-crash-mute 'sleep'` without running it, and does not file an issue (gh is not authenticated).
  * Round trip: type `omarchy theme set tokyo-night`; close the agent window with Super+W.
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * Record as not runnable unless the harness can supply an API key inside the guest. Crash capture is silent on a stock disk until a default agent is set.
  </Hints>
  </Instructions>
proof: |
  * on success
  ** Screenshot of the agent transcript reading the skill and running `omarchy theme set nord`, with the desktop retinted; the crash-diagnosis transcript following the skill's report format and offering the mute
  * If unsuccessful
  ** Screenshot of the agent transcript and of `omarchy default agent`
covers: default/agents/skills/omarchy/SKILL.md (whole); default/agents/skills/diagnose-crash/SKILL.md, reporting.md; bin/omarchy-agent; bin/omarchy-agent-crash; manual/17-ai.md
merged-from: 61:shipped-skill-agent-changes-theme

## Moved to other domains

- 50:menu-root-walk-bar-position-left → B — tests keyboard-only menu navigation (root → Style → Menu Bar → Position), not bar styling (orchestrator decision).
- 11:rsync-watchers → H — shell functions `rsw`/`lsw`/`dsw` (orchestrator decision).
- 41:man-pages-render-through-bat → H — shell environment (`MANPAGER`/bat), not styling (orchestrator decision).
- 21:apply-hardware-system-argument-guards → H — argument guards of the privileged provisioning commands `omarchy-apply-hardware`/`omarchy-apply-system`; nothing is styled.
- 30:notification-icon-image-and-glyph → D — toast icon-slot rendering (image hint, themed icon, glyph, collapsed slot) belongs with notifications.
- 41:chromium-whatsapp-slim-theme → F2 — the WhatsApp web app and its bundled Chromium extension forcing system-theme mode is an app-in-use story, not the Omarchy theme system.

## Dropped

(none)
