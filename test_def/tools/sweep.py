#!/usr/bin/env python3
"""Sweep after routing: fold rerouted stragglers, delete duplicate-story blocks, extend merged-from."""
import re
TD = "/home/theprimeagen/personal/oligarchy/test_def"
F = {
    "B": f"{TD}/93-final-B-menu-launch.md",
    "C": f"{TD}/94-final-C-hyprland-windows.md",
    "D": f"{TD}/95-final-D-bar-panels-notify.md",
    "G2": f"{TD}/100-final-G2-cli-router-dev-debug.md",
    "H": f"{TD}/101-final-H-system-shell-security.md",
}

def read(p): return open(p, encoding="utf-8").read()
def write(p, s): open(p, "w", encoding="utf-8").write(s)

def extend_merged_from(path, test, refs):
    s = read(path)
    m = re.search(rf"^### {re.escape(test)}\s.*?\n(.*?)(?=^### |^## |\Z)", s, re.M | re.S)
    assert m, f"test {test} not found in {path}"
    block = m.group(0)
    mf = re.search(r"^merged-from:\s*(.*)$", block, re.M)
    assert mf, f"no merged-from in {test}"
    have = [x.strip() for x in mf.group(1).split(";") if x.strip()]
    new = have + [r for r in refs if r not in have]
    nb = block.replace(mf.group(0), "merged-from: " + "; ".join(new))
    write(path, s.replace(block, nb))
    print(f"  + {test}: +{len(new)-len(have)} refs -> {len(new)}")

def delete_block(path, test):
    s = read(path)
    m = re.search(rf"^### {re.escape(test)}\s.*?\n(.*?)(?=^### |^## |\Z)", s, re.M | re.S)
    assert m, f"test {test} not found in {path}"
    mf = re.search(r"^merged-from:\s*(.*)$", m.group(0), re.M)
    refs = [x.strip() for x in mf.group(1).split(";") if x.strip()] if mf else []
    write(path, s.replace(m.group(0), ""))
    print(f"  - deleted {test} from {path.split('/')[-1]} (refs {refs})")
    return refs

def drop_moved_line(path, ref):
    s = read(path)
    n = len(s)
    s2 = re.sub(rf"^\s*[-*]\s+`?{re.escape(ref)}`?\s*(?:→|->|—).*\n", "", s, flags=re.M)
    write(path, s2)
    print(f"  ~ dropped Moved line for {ref} in {path.split('/')[-1]}: {'yes' if len(s2) < n else 'NOT FOUND'}")

print("1. rerouted stragglers")
extend_merged_from(F["C"], "autostart-lua-user-entry-runs-on-login", ["12:autostart-lua-launch-on-start"])
extend_merged_from(F["D"], "dev-gallery-controls-walk-and-dropdowns", ["31:dev-gallery-text-and-number-fields"])
extend_merged_from(F["H"], "provision-rerun-guards-force-replay-and-hooks-once", ["42:firstrun-force-rerun-toasts", "42:firstrun-offline-shows-wifi-toast"])
extend_merged_from(F["B"], "launch-docker-tui-polkit-gate", ["11:lazydocker-polkit-prompt"])
extend_merged_from(F["H"], "zram-swap-active-and-oomd-kills-runaway-app", ["41:oomd-app-slice-candidacy"])

print("2. D/G2 agent-invitation duplicate -> keep D")
refs = delete_block(F["G2"], "agent-invitation-toast-once")
extend_merged_from(F["D"], "agent-invitation-toast-once", refs)
drop_moved_line(F["D"], "22:agent-invitation-notification")
drop_moved_line(F["G2"], "51:agent-invitation-hook-once")

print("3. B/H nightlight + shell-restart duplicates -> keep B")
refs = delete_block(F["H"], "nightlight-toggle-hotkey-menu-and-status")
extend_merged_from(F["B"], "nightlight-toggle-hotkey-menu-and-status", refs)
refs = delete_block(F["H"], "shell-supervisor-relaunches-after-crash")
refs += delete_block(F["H"], "shell-restart-from-menu-and-lock-guard")
extend_merged_from(F["B"], "shell-restart-from-menu-and-supervisor-relaunch", refs)
for r in ["10:nightlight-toggle-hotkey-status", "22:launch-shell-supervisor-recovers", "25:restart-shell-from-menu"]:
    drop_moved_line(F["B"], r)
for r in ["32:nightlight-toggle-service", "32:shell-supervisor-relaunches-after-crash", "51:shell-supervisor-relaunches-and-gives-up", "32:restart-shell-keeps-desktop-working"]:
    drop_moved_line(F["H"], r)
print("done")
