#!/usr/bin/env python3
"""Split the large domain slices into two halves each by story regex; rewrite domain files."""
import json, re, os
D = "/tmp/omarchy-review/domains"
SPLITS = {
    "A-session-power": ("A1-lock-idle-session", r"lock|idle|screensaver|stay-awake|sddm|greeter|login|logout|faillock|lockout|stranded|dpms|sleep|suspend|hibernat|lid|session",
                        "A2-power-boot-snapshots"),
    "F-install-apps": ("F1-install-remove-machinery", r"install|remove|pkg|mise|dev-env|preinstall|tui-|windows|tailscale|voxtype|dictation|aur|opr",
                       "F2-apps-in-use"),
    "G-update-cli": ("G1-update-migrations-channels", r"update|migrat|channel|version|pacman|keyring|orphan|db\.lck|disk-space|low-disk|quattro|mirror|reinstall|kernel",
                     "G2-cli-router-dev-debug"),
}
for dom, (a, rx, b) in SPLITS.items():
    ts = json.load(open(f"{D}/{dom}.json"))
    A = [t for t in ts if re.search(rx, t["name"].lower())]
    B = [t for t in ts if not re.search(rx, t["name"].lower())]
    json.dump(A, open(f"{D}/{a}.json", "w"), indent=1)
    json.dump(B, open(f"{D}/{b}.json", "w"), indent=1)
    os.remove(f"{D}/{dom}.json")
    print(f"{dom}: {len(ts)} -> {a} {len(A)} / {b} {len(B)}")
for f in sorted(os.listdir(D)):
    print(f"{f:40} {len(json.load(open(f'{D}/{f}'))):4}")
