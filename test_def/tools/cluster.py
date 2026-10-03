#!/usr/bin/env python3
"""Propose same-story clusters inside one domain slice; print compactly for manual merge decisions."""
import json, re, sys
from itertools import combinations

dom = sys.argv[1]
thr = float(sys.argv[2]) if len(sys.argv) > 2 else 0.5
ts = json.load(open(f"/tmp/omarchy-review/domains/{dom}.json"))
STOP = set("""a an the and or of to in on for with via from by is are not no without into out
rejects reject refuses refuse opens open shows show works work test tests path paths then
after before while when once one two all any bad input invalid unknown missing absent hidden
its own does do vm qemu guest driver cli menu ui set sets get run runs runnable roundtrip round trip
mode modes flag flags entry entries row rows toggle toggles negative positive happy unhappy""".split())

def toks(t):
    words = re.split(r"[-_/ ]+", t["name"].lower())
    s = {w for w in words if w and w not in STOP and len(w) > 2}
    # add covers file basenames as strong tokens
    for m in re.findall(r"([A-Za-z0-9_.-]+\.(?:sh|lua|qml|jsonc|md|py))", t["covers"]):
        s.add("f:" + m.lower())
    for m in re.findall(r"omarchy-[a-z0-9-]+", t["covers"] + " " + t["description"].lower()):
        s.add("c:" + m)
    return s

T = [toks(t) for t in ts]
n = len(ts)
parent = list(range(n))
def find(x):
    while parent[x] != x:
        parent[x] = parent[parent[x]]; x = parent[x]
    return x
def union(a, b):
    ra, rb = find(a), find(b)
    if ra != rb: parent[rb] = ra

for i, j in combinations(range(n), 2):
    a, b = T[i], T[j]
    if not a or not b: continue
    jac = len(a & b) / len(a | b)
    same_name = ts[i]["name"] == ts[j]["name"]
    dd = ts[i]["name"] in ts[j]["dedupe_with"] or ts[j]["name"] in ts[i]["dedupe_with"]
    if same_name or dd or jac >= thr:
        union(i, j)

clusters = {}
for i in range(n):
    clusters.setdefault(find(i), []).append(i)
multi = [c for c in clusters.values() if len(c) > 1]
single = [c[0] for c in clusters.values() if len(c) == 1]
print(f"# {dom}: {n} blocks, {len(multi)} clusters (>=2), {len(single)} singles")
for k, c in enumerate(sorted(multi, key=lambda c: -len(c))):
    print(f"\n## C{k+1}")
    for i in c:
        t = ts[i]
        tag = "/".join(x for x in t["tags"] if x.startswith("VM"))[:10] + ("+N" if "NET" in t["tags"] else "") + ("+S" if "SLOW" in t["tags"] else "")
        print(f"  {t['src'][:2]} {t['name']:58} {tag:14} {t['steps']:2}st {'H' if t['has_hints'] else '-'}  {t['description'][:90]}")
print(f"\n## singles ({len(single)})")
for i in sorted(single, key=lambda i: ts[i]["name"]):
    t = ts[i]
    tag = "/".join(x for x in t["tags"] if x.startswith("VM"))[:10] + ("+N" if "NET" in t["tags"] else "") + ("+S" if "SLOW" in t["tags"] else "")
    print(f"  {t['src'][:2]} {t['name']:58} {tag:14} {t['steps']:2}st {'H' if t['has_hints'] else '-'}  {t['description'][:90]}")
