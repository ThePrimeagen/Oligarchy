#!/usr/bin/env python3
"""Index every '### <name>   [TAGS]' test block in test_def/*.md into JSON."""
import json, re, sys, glob, os
from collections import Counter, defaultdict

ROOT = "/home/theprimeagen/personal/oligarchy/test_def"
HEAD = re.compile(r"^### (?P<name>[a-z0-9][a-z0-9-]*)\s+(?P<tags>(?:\[[A-Za-z0-9+-]+\]\s*)+)\s*$")

def parse_file(path):
    src = os.path.basename(path)
    lines = open(path, encoding="utf-8").read().split("\n")
    tests = []
    i = 0
    while i < len(lines):
        m = HEAD.match(lines[i])
        if not m:
            i += 1
            continue
        name = m.group("name")
        tags = re.findall(r"\[([A-Za-z0-9+-]+)\]", m.group("tags"))
        start = i
        i += 1
        body = []
        while i < len(lines) and not lines[i].startswith("### ") and not lines[i].startswith("## "):
            body.append(lines[i])
            i += 1
        text = "\n".join(body)
        def field(key):
            mm = re.search(rf"^{key}:\s*(.*)$", text, re.M)
            return mm.group(1).strip() if mm else ""
        # instruction / proof are block scalars: capture until next top-level key
        def block(key):
            mm = re.search(rf"^{key}:\s*\|?\s*\n(.*?)(?=^\S|\Z)", text, re.M | re.S)
            return mm.group(1) if mm else ""
        instr = block("instruction")
        steps = len(re.findall(r"^\s*\* ", instr, re.M))
        tests.append({
            "src": src, "line": start + 1, "name": name, "tags": tags,
            "description": field("description"),
            "covers": field("covers"),
            "dedupe_with": field("dedupe-with"),
            "steps": steps,
            "has_hints": "<Hints>" in instr,
            "has_closing": ("crashes or erroneous" in instr) and ("screen shot" in instr or "screenshot" in instr),
            "instruction": instr, "proof": block("proof"),
        })
    return tests

def main():
    files = sorted(glob.glob(f"{ROOT}/[1-6][0-9]-*.md"))
    allt = []
    for f in files:
        allt.extend(parse_file(f))
    out = {"files": [os.path.basename(f) for f in files], "tests": allt}
    json.dump(out, open("/tmp/omarchy-review/index.json", "w"), indent=1)
    # summary
    by_src = Counter(t["src"] for t in allt)
    print(f"{'file':45} tests")
    for f in out["files"]:
        print(f"{f:45} {by_src.get(f,0):5}")
    print(f"{'TOTAL':45} {len(allt):5}")
    tagc = Counter()
    for t in allt:
        main_tag = next((x for x in t["tags"] if x.startswith("VM-")), "?")
        tagc[main_tag] += 1
        for x in t["tags"]:
            if x in ("NET", "SLOW"):
                tagc[x] += 1
    print("tags:", dict(tagc))
    names = Counter(t["name"] for t in allt)
    dups = {n: c for n, c in names.items() if c > 1}
    print(f"duplicate names: {len(dups)}")
    for n, c in sorted(dups.items()):
        srcs = [t["src"][:2] for t in allt if t["name"] == n]
        print(f"  {n} x{c} ({','.join(srcs)})")
    dd = [t for t in allt if t["dedupe_with"]]
    print(f"dedupe-with hints: {len(dd)}")
    for t in dd:
        print(f"  {t['src'][:2]} {t['name']} -> {t['dedupe_with']}")
    missing = [t for t in allt if not t["has_hints"] or not t["has_closing"]]
    print(f"missing hints/closing bullets: {len(missing)}")
    for t in missing[:40]:
        print(f"  {t['src'][:2]} {t['name']} hints={t['has_hints']} closing={t['has_closing']}")
    long_ = [t for t in allt if t["steps"] > 11]
    print(f"blocks with >11 top-level bullets: {len(long_)}")
    for t in long_[:30]:
        print(f"  {t['src'][:2]} {t['name']} steps={t['steps']}")

if __name__ == "__main__":
    main()
