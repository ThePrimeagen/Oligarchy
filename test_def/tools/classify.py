#!/usr/bin/env python3
"""Assign every indexed test block to a synthesis domain and write per-domain slices."""
import json, re, os
from collections import Counter

IDX = json.load(open("/tmp/omarchy-review/index.json"))
OUT = "/tmp/omarchy-review/domains"
os.makedirs(OUT, exist_ok=True)

# (domain, regex on "name covers description")  — first match wins; order matters.
RULES = [
    ("I-iso-appendix", r"VM-OK-from-ISO|\binstall-(rejects|declines|custom|deferred|from-iso|unattended)|unattended|cidata|dual-boot|iso-boot"),
    ("A-session-power", r"lock|luks|passphrase|sddm|greeter|login|logout|idle|screensaver|stay-awake|suspend|hibernat|reboot|shutdown|power-menu|system-menu|faillock|lockout|direct-boot|factory-reset|snapshot|limine|plymouth-luks|resume-boot|boot-chain|boot-config|sleep|lid|dpms|stranded"),
    ("G-update-cli", r"update|migrat|channel|version|pacman|keyring|orphan|db\.lck|disk-space|low-disk|upgrade-to-quattro|quattro|cli-|router|omarchy-help|commands-|hook|state-and-done|done-marker|dev-(link|status|benchmark|pkg|ui|install|font|theme-preview)|debug|upload-log|reinstall|finalize|mirror|preinstall"),
    ("E-theme-style", r"theme|background|wallpaper|font|branding|plymouth|refresh-|apply-|about-text|about-image|screensaver-text|bar-position|bar-transparen|colors?\.toml|aether|light-dark|gnome-settings|icon-font|glyph"),
    ("F-install-apps", r"install|remove|pkg-|mise|dev-env|webapp|web-app|tui-|windows-vm|tailscale|voxtype|dictation|steam|gaming|browser-(chrome|firefox|zen|brave|edge)|1password|dropbox|spotify|signal|bitwarden|omacalc|omawrite|omacut|omasnap|omareel|herdr|owe|hype|monologue|ttfx|elsewhen|opr|aur"),
    ("B-menu-launch", r"menu|launcher|apps-|app-launch|keybindings-viewer|about|learn|launch-|floating-terminal|share|transcode|picker-cancel|dmenu|select-and-input|timezone-list"),
    ("D-bar-panels-notify", r"bar|panel|osd|notification|toast|reminder|tray|clipboard|emoji|image-picker|polkit|pkexec|clock|calendar|weather|speedtest|speed-test|network-panel|audio-panel|bluetooth|monitor-panel|dnd|do-not-disturb|indicator|widget"),
    ("C-hyprland-windows", r"hypr|window|workspace|tiling|float|fullscreen|scratchpad|group|resize|swap|focus|zoom|monitor|scal|display|text-size|binding|chord|input-lua|layout|compose|xcompose|keyboard-layout|gaps|transparen|opacity|reload-guard|anr|capture|screenshot|screenrecord|color-picker|ocr|print"),
    ("H-system-shell-security", r"shell-|alias|bash|tmux|lazygit|btop|nvim|neovim|git-|fastfetch|terminal|kitty|foot|alacritty|ghostty|mime|xdg|default-(app|browser|editor|terminal|agent)|chromium|extension|policy|cups|print|docker|firewall|ufw|sudo|sshd|ssh|fido2|fingerprint|security|dns|network|wifi|agent|crash|diagnose|coredump|skill|first-run|firstrun|provision|hardware|hw-|quirk|zram|systemd|service|unit|locale|timezone|user-dirs|kernel|sysctl|environment|env-|xcompose|fcitx|localsend|nautilus|files|imv|mpv|pdf|xournal|obsidian|opencode|claude|codex|ai-|herdr"),
]
DEFAULT_BY_SRC = {
    "10": "B-menu-launch", "11": "H-system-shell-security", "12": "H-system-shell-security",
    "13": "A-session-power", "20": "G-update-cli", "21": "E-theme-style", "22": "B-menu-launch",
    "23": "F-install-apps", "24": "A-session-power", "25": "C-hyprland-windows",
    "30": "D-bar-panels-notify", "31": "D-bar-panels-notify", "32": "A-session-power",
    "40": "C-hyprland-windows", "41": "H-system-shell-security", "42": "H-system-shell-security",
    "43": "G-update-cli", "50": "D-bar-panels-notify", "51": "H-system-shell-security",
    "52": "H-system-shell-security", "60": "F-install-apps", "61": "G-update-cli",
}

def classify(t):
    hay = f"{t['name']} {t['covers']} {t['description']}".lower()
    tags = " ".join(t["tags"])
    if "VM-NO" in tags and ("ISO" in tags or re.search(r"iso|unattended|cidata|installer", hay)):
        return "I-iso-appendix"
    for dom, rx in RULES:
        if re.search(rx, t["name"].lower()):
            return dom
    for dom, rx in RULES:
        if re.search(rx, hay):
            return dom
    return DEFAULT_BY_SRC[t["src"][:2]]

slices = {}
for t in IDX["tests"]:
    d = classify(t)
    t["domain"] = d
    slices.setdefault(d, []).append(t)

for d, ts in sorted(slices.items()):
    json.dump(ts, open(f"{OUT}/{d}.json", "w"), indent=1)
    c = Counter(x["src"][:2] for x in ts)
    print(f"{d:28} {len(ts):5}  " + " ".join(f"{k}:{v}" for k, v in sorted(c.items())))
json.dump(IDX, open("/tmp/omarchy-review/index.json", "w"), indent=1)
print("total", len(IDX["tests"]))
