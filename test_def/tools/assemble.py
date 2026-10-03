#!/usr/bin/env python3
"""Parse the final domain files, check accounting against the source index, write the coverage
matrix and TESTS.md."""
import json, re, glob, os, sys
from collections import Counter, OrderedDict

TD = "/home/theprimeagen/personal/oligarchy/test_def"
IDX = json.load(open("/tmp/omarchy-review/index.json"))
SRC = OrderedDict()
for t in IDX["tests"]:
    SRC[f"{t['src'][:2]}:{t['name']}"] = t

HEAD = re.compile(r"^### (?P<name>[a-z0-9][a-z0-9-]*)\s+(?P<tags>(?:\[[A-Za-z0-9+-]+\]\s*)+)\s*$")

def parse_final(path):
    text = open(path, encoding="utf-8").read()
    lines = text.split("\n")
    title = lines[0].lstrip("# ").strip()
    title = re.sub(r"\s*[—-]+\s*final tests\s*$", "", title)
    title = re.sub(r"^[A-Z][12]?\s*[—-]+\s*", "", title)
    # sections
    sec = None
    sections = {"tests": [], "notrun": [], "moved": [], "dropped": [], "intro": []}
    cur = None
    for i, ln in enumerate(lines):
        if ln.startswith("## "):
            h = ln[3:].strip().lower()
            if h.startswith("tests"): sec = "tests"
            elif h.startswith("not runnable"): sec = "notrun"
            elif h.startswith("moved") or h.startswith("rerouted"): sec = "moved"
            elif h.startswith("dropped"): sec = "dropped"
            else: sec = None
            cur = None
            continue
        if sec in ("tests", "notrun"):
            m = HEAD.match(ln)
            if m:
                cur = {"name": m.group("name"), "tags": re.findall(r"\[([A-Za-z0-9+-]+)\]", m.group("tags")),
                       "body": [], "file": os.path.basename(path), "domain": title}
                sections[sec].append(cur)
            elif cur is not None:
                cur["body"].append(ln)
        elif sec in ("moved", "dropped"):
            m = re.match(r"^\s*[-*]\s+(?P<ref>\d\d:[a-z0-9][a-z0-9-]*)\s*(?:→|->|—|-)\s*(?P<rest>.*)$", ln)
            if m:
                sections[sec].append({"ref": m.group("ref"), "rest": m.group("rest").strip()})
        elif sec is None and i > 0 and not ln.startswith("#"):
            sections["intro"].append(ln)
    for t in sections["tests"] + sections["notrun"]:
        body = "\n".join(t["body"])
        mf = re.search(r"^merged-from:\s*(.*)$", body, re.M)
        t["merged_from"] = [x.strip() for x in re.split(r"[;,]\s*", mf.group(1))] if mf else []
        t["merged_from"] = [x for x in t["merged_from"] if re.match(r"^\d\d:", x)]
        cv = re.search(r"^covers:\s*(.*)$", body, re.M)
        t["covers"] = cv.group(1).strip() if cv else ""
        ds = re.search(r"^description:\s*(.*)$", body, re.M)
        t["description"] = ds.group(1).strip() if ds else ""
        # block text without merged-from line (keep covers)
        t["text"] = re.sub(r"^merged-from:.*\n?", "", body, flags=re.M).rstrip()
    return title, sections

def main(write=False):
    files = sorted(glob.glob(f"{TD}/9[0-9]-final-*.md") + glob.glob(f"{TD}/1[0-9][0-9]-final-*.md"),
                   key=lambda p: int(os.path.basename(p).split("-")[0]))
    placed = {}      # src ref -> (final name, file, kind)
    finals = []      # (title, sections)
    dupnames = Counter()
    for f in files:
        title, sec = parse_final(f)
        finals.append((title, sec, f))
        for kind in ("tests", "notrun"):
            for t in sec[kind]:
                dupnames[t["name"]] += 1
                for ref in t["merged_from"]:
                    placed.setdefault(ref, []).append((t["name"], os.path.basename(f), kind))
        for m in sec["moved"]:
            placed.setdefault(m["ref"], []).append((f"MOVED → {m['rest'][:60]}", os.path.basename(f), "moved"))
        for d in sec["dropped"]:
            placed.setdefault(d["ref"], []).append((f"DROPPED: {d['rest'][:80]}", os.path.basename(f), "dropped"))
    # report
    print(f"final files: {len(files)}")
    tot_tests = sum(len(s["tests"]) for _, s, _ in finals)
    tot_nr = sum(len(s["notrun"]) for _, s, _ in finals)
    print(f"final tests: {tot_tests}   not-runnable: {tot_nr}")
    for title, s, f in finals:
        acc = sum(len(t["merged_from"]) for t in s["tests"] + s["notrun"]) + len(s["moved"]) + len(s["dropped"])
        print(f"  {os.path.basename(f):48} tests={len(s['tests']):3} notrun={len(s['notrun']):2} moved={len(s['moved']):2} dropped={len(s['dropped']):2} accounted={acc}")
    unknown = [r for r in placed if r not in SRC]
    missing = [r for r in SRC if r not in placed]
    multi = {r: v for r, v in placed.items() if sum(1 for _, _, k in v if k != "moved") > 1}
    print(f"source blocks: {len(SRC)}  placed: {len([r for r in SRC if r in placed])}  missing: {len(missing)}  unknown refs: {len(unknown)}  multi-placed: {len(multi)}")
    dn = {n: c for n, c in dupnames.items() if c > 1}
    print(f"duplicate final names across files: {len(dn)} {sorted(dn)[:20]}")
    moved_only = [r for r, v in placed.items() if all(k == "moved" for _, _, k in v)]
    print(f"moved-only (need routing): {len(moved_only)}")
    if "-v" in sys.argv:
        print("MISSING:"); [print("  ", r) for r in missing]
        print("UNKNOWN:"); [print("  ", r) for r in unknown]
        print("MOVED-ONLY:"); [print("  ", r, placed[r][0][0]) for r in moved_only]
        print("MULTI:"); [print("  ", r, v) for r, v in multi.items()]
    if not write:
        return
    # coverage matrix
    with open(f"{TD}/90-coverage-matrix.md", "w") as o:
        o.write("# Coverage matrix — every proposed block → its final test\n\n")
        o.write(f"{len(SRC)} proposed blocks from 22 reviewer files → {tot_tests} final tests + {tot_nr} not-runnable-here tests.\n\n")
        o.write("| source (file:name) | final test | in |\n|---|---|---|\n")
        for r in SRC:
            v = placed.get(r)
            if not v:
                o.write(f"| `{r}` | **UNACCOUNTED** | |\n"); continue
            name, f, kind = v[-1] if all(k == "moved" for _, _, k in v[:-1]) else v[0]
            o.write(f"| `{r}` | {'`'+name+'`' if kind in ('tests','notrun') else name} | {f.split('-final-')[-1][:-3] if '-final-' in f else f} |\n")
    # TESTS.md
    pre = open(f"{TD}/02-PREAMBLE.md").read().split("\n", 1)[1]
    tagc = Counter()
    for _, s, _ in finals:
        for t in s["tests"]:
            tagc[next((x for x in t["tags"] if x.startswith("VM-")), "?")] += 1
            for x in t["tags"]:
                if x in ("NET", "SLOW"): tagc[x] += 1
    with open(f"{TD}/TESTS.md", "w") as o:
        o.write("# Omarchy acceptance tests — the list\n\n")
        o.write(f"**{tot_tests} runnable tests** ({tagc.get('VM-OK',0)} VM-OK, {tagc.get('VM-PARTIAL',0)} VM-PARTIAL; "
                f"{tagc.get('NET',0)} need network, {tagc.get('SLOW',0)} are slow) plus **{tot_nr} not runnable on the resumed disk** "
                f"(appendix). Distilled from {len(SRC)} proposed blocks; see `90-coverage-matrix.md`.\n\n")
        o.write(pre.strip() + "\n\n")
        o.write("## Contents\n\n")
        for title, s, f in finals:
            o.write(f"- {title} — {len(s['tests'])} tests" + (f", {len(s['notrun'])} not runnable" if s['notrun'] else "") + "\n")
        o.write("\n---\n\n")
        for title, s, f in finals:
            if not s["tests"]: continue
            o.write(f"# {title}\n\n")
            intro = "\n".join(s["intro"]).strip()
            intro = re.split(r"\n\s*\n", intro)[0] if intro else ""
            if intro: o.write(intro + "\n\n")
            for t in s["tests"]:
                o.write(f"### {t['name']}   " + " ".join(f"[{x}]" for x in t["tags"]) + "\n")
                o.write(t["text"] + "\n\n")
        o.write("\n---\n\n# Appendix — not runnable on the resumed minted disk\n\n")
        o.write("These need a fresh ISO boot (`[VM-OK-from-ISO]`), hardware the guest lacks, or more than a session's budget. Kept in full so a variant ticket can run them.\n\n")
        for title, s, f in finals:
            if not s["notrun"]: continue
            o.write(f"## {title}\n\n")
            for t in s["notrun"]:
                o.write(f"### {t['name']}   " + " ".join(f"[{x}]" for x in t["tags"]) + "\n")
                o.write(t["text"] + "\n\n")
        o.write("\n---\n\n# Index of test names\n\n")
        for title, s, f in finals:
            for t in s["tests"] + s["notrun"]:
                o.write(f"- `{t['name']}` — {t['description'][:110]}\n")
    print("wrote 90-coverage-matrix.md and TESTS.md")

if __name__ == "__main__":
    main(write="-w" in sys.argv)
