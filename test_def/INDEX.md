# test_def — index and hand-off

Read this first if you are picking up the work. It says what the job is, what every file here is,
exactly where the work stands, and the remaining steps with the commands to run.

## 1. The job

Review everything a user can do with Omarchy (https://github.com/omacom/omarchy, plus the omacom
org repos that ship inside it) and produce acceptance-test definitions for the `test_definitions`
table (`name`, `description`, `instruction`, `proof` — see `drizzle/0001_init.sql`). Each test is
driven by an LLM against a QEMU guest through `./client` only (keys, mouse, screenshot, serial), in
the voice and shape of the existing `lock-screen` definition. Deliverable: `test_def/TESTS.md`.

Constraints the user set mid-way (all captured in `00-FORMAT.md`):
- **Rule zero** — every step is UI or a terminal opened inside the guest; the whole test must be
  specifiable as `./client` verbs (`send-keys`, `mouse …`, `get-image`, `get-serial`). No host-side
  channel, no file transfer, no hardware simulation. Everything is tested via QEMU.
- **Calibration** — one user story per test, 5–9 steps with `**` caveats, quirk named, round trip
  asserted, two closing bullets, `<Hints>`, concrete proof. `lock-screen` is the model.

## 2. Files in this directory

| file | what it is | read when |
|---|---|---|
| `INDEX.md` | this hand-off | first |
| `00-FORMAT.md` | the spec every test follows: table columns, rule zero, `./client` verb table, the `lock-screen` calibration, feasibility tags, notes-file layout | before writing or judging any test |
| `00-PLAN.md` | partition into 22 reviewers, per-file status, sub-agent ids (resumable), synthesis dispatch table, watch items, synthesis fix-ups, log | to see status history |
| `01-FACTS.md` | cross-reviewer facts about the guest and the code, each tagged with the reviewer that found it and corrections (`corrects 12`) — driver key set, boot/login, menu quirks, timeouts, exact strings, sizes, defects, verdicts | when writing hints/proofs; it overrides individual reviewers |
| `02-PREAMBLE.md` | draft preamble for TESTS.md: guest description, driver conventions, operator notes, harness improvement candidates, defect list annotated with verdicts | it becomes the top of TESTS.md |
| `03-INTENDED-BEHAVIOUR.md` | git-history verdict for every manual-vs-code disagreement and suspected defect (shas, dates, open issues/PRs): CODE-INTENDED 15 · DEFECT 11 · MANUAL-INTENDED 1 · UNCLEAR 3 | when a proof must choose which side to assert |
| `10-…13-*.md` | reviewer notes for the manual (ch. 01–14, 15–29, 30–43, 44–51) | inventory/audit trail |
| `20-…25-*.md` | reviewer notes for `bin/` (router+misc, theme/branding, launch/menu/webapp, install/remove/pkg, system/power/update, hyprland/toggle/desktop) | inventory/audit trail |
| `30-…32-*.md` | reviewer notes for `shell/` (bar/OSD/notifications, panels/menu/pickers, lock/background/services) | inventory/audit trail |
| `40-…43-*.md` | reviewer notes for Hyprland bindings/config, `default/`+`etc/`+`config/`, installer+ISO+provisioning, migrations+update | inventory/audit trail |
| `50-…52-*.md` | reviewer notes for the maintainers' own tests (acceptance suite; shell tests a–l; m–z) — 1,037+165 asserted contracts mapped to driver stories | inventory/audit trail |
| `60-…61-*.md` | reviewer notes for the omacom org repos (what ships) and docs/plans/agent skills | inventory/audit trail |
| `91-…102-final-*.md` | **synthesizer outputs**: per-domain final tests (`## Tests`), `## Not runnable here`, `## Moved to other domains`, `## Dropped`; every test carries `merged-from: NN:name; …` | these are concatenated into TESTS.md |
| `90-coverage-matrix.md` | every proposed block → its final test (1,235 rows) | to audit coverage |
| `TESTS.md` | **the deliverable**: 468 runnable tests + 37 appendix, grouped by domain, each a `test_definitions` row | to load tests / to review |
| `tools/` | the scripts and the synthesis brief (see §5) | to regenerate/verify |

Each reviewer file has five sections: Scope · Inventory (every hotkey/menu row/command/widget/
migration/assertion with a source reference) · Observations · Proposed tests (`### name [tags]`
blocks) · Gaps. The inventories are the audit trail that "everything was reviewed".

## 3. Where the work stands (2026-09-18 16:50) — COMPLETE

Done:
- 22 reviewers finished; 21 of 22 files had a compliance pass against the final spec (42's was lost
  to a billing outage; synthesizers normalised its blocks). 1,235 proposed blocks total.
- History research done (`03-INTENDED-BEHAVIOUR.md`).
- 12 domain synthesizers finished writing (`91-…102-final-*.md`). `tools/assemble.py` reports
  **1,235/1,235 blocks placed, 0 missing, 0 unknown refs, 0 double placements, 0 duplicate final
  names**; **426 runnable tests + 31 not-runnable** so far.

All steps below are done; `TESTS.md` (468 runnable + 37 not-runnable, 505 blocks, 16.8k lines) and
`90-coverage-matrix.md` (1,235 rows, every proposed block → its final test) are written and verified:
every block has description/instruction/proof/covers, `<Hints>`, both closing bullets, 5–9 ActionList
steps; accounting 1,235/1,235 with 0 missing, 0 double-placed, 0 duplicate names; cross-domain
same-story duplicates merged (Plymouth, no-default-agent, plugin clone, plugin enable/disable,
nightlight, shell restart, agent invitation). Steps as they were run, for the record:
1. **Routing pass** — 224 blocks were marked `Moved to other domains` by their synthesizer and are
   not yet merged into the target domain's file (`assemble.py` lists them as "moved-only"). For each
   target domain, resume that domain's synthesizer (ids in `00-PLAN.md` synthesis table; the
   `Moved` lines name the sibling test to fold into) with its incoming list and have it merge them
   (existing test or new test) and extend `merged-from:`. Then re-run `assemble.py` until
   "moved-only: 0".
2. **Reconciliation pass** — synthesizers that finished before `03-INTENDED-BEHAVIOUR.md` existed
   (A1, A2, F2, G2, I) asserted the code's behaviour on disputed items. Apply the verdict table
   (§ "Verdicts" in `01-FACTS.md`): DEFECT / MANUAL-INTENDED items assert the *intended* side and
   record HEAD's behaviour as the failure; CODE-INTENDED assert code. Items most likely affected in
   those files: #4 snapshot unknown action (A2), #7 battery notice (D — done), #10 `update -y` (G1
   — check), #11/#25 `finalize`/`agent` description (G2), #29 1Password Remove row (F1/F2). Also
   add a `lock-screen` (v2) wording under A1 with the clock removed and "System menu" named.
3. **Assemble** — `python3 tools/assemble.py -w` writes `90-coverage-matrix.md` and `TESTS.md`
   (preamble from `02-PREAMBLE.md` + all domain `## Tests` + appendix of not-runnable + index of
   names). Then read TESTS.md top to bottom once; fix obvious seams (domain intro paragraphs,
   duplicate stories that crossed domains — the assembler flags duplicate names but not duplicate
   stories with different names).
4. **Report** to the user: counts, the defect list, harness improvement candidates, operator notes
   (update once and `save` the disk; ISO ticket for the appendix).
5. **Hand-off to the cloud** (user request): commit only `test_def/` on a new branch, push to
   `origin`, and start a cloud agent on that branch with the prompt "what should we do?" pointed at
   this INDEX. The unrelated `src/viz` / `test/` working-tree modifications are not part of this work
   and are left uncommitted.
6. Optional next: load into the DB with `./ctrl test define --name … --description … --instruction
   … --proof …` per block (a small script over TESTS.md is the obvious way; instruction/proof are
   multi-line — pass them as quoted arguments or via `$(cat file)`).

## 4. Scratch outside the repo (`/tmp/omarchy-review/`, 343 MB — may be gone after a reboot)

| path | what | regenerate |
|---|---|---|
| `omarchy/` | full-history clone @ `d174d4a` (tags v4.0.2, v4.0.4 fetched) | `git clone https://github.com/omacom/omarchy && git -C omarchy checkout d174d4a` |
| `omarchy-iso/` | ISO builder @ `7cfb711` | `git clone --depth 1 https://github.com/omacom/omarchy-iso` |
| `org/` | clones/READMEs of other org repos used by reviewer 60 | not needed again |
| `org-repos.json` | GitHub org listing | copied to `tools/` |
| `index.json` | every proposed block parsed from `test_def/[1-6]*.md` | `python3 tools/extract.py` |
| `domains/*.json|*.md` | the 12 domain slices handed to synthesizers | `tools/classify.py` then `tools/split.py` (see §5) |
| `clusters/*.txt` | token-similarity cluster suggestions per slice | `tools/cluster.py <slice> 0.34` |
| `SYNTH.md` | the synthesis brief | copied to `tools/` |

The scripts hard-code `/tmp/omarchy-review` and `/home/theprimeagen/personal/oligarchy/test_def`;
edit the constants at the top if paths differ.

## 5. Tools (`tools/`)

- `extract.py` — parse every `### name [TAGS]` block in the reviewer files into `index.json`; prints
  per-file counts, tag totals, duplicate names, `dedupe-with` hints, blocks missing hints/closing
  bullets, over-long blocks.
- `classify.py` — regex router assigning each block to a domain slice; `split.py` halves A/F/G.
  (Only needed to redo synthesis from scratch; the slices the synthesizers used are the snapshot
  taken at 15:36 — 11's and 25's late compliance passes changed their files afterwards, so matrix
  keys use the snapshot names. `index.json` is that snapshot; do not re-run `extract.py` over the
  reviewer files unless you also re-run synthesis.)
- `cluster.py <slice> [thr]` — same-story cluster suggestions for a slice.
- `assemble.py [-v] [-w]` — parse the final files, check accounting against `index.json`
  (`-v` lists missing/unknown/moved-only/multi-placed), `-w` writes the matrix and TESTS.md.
- `SYNTH.md` — the brief every synthesizer followed (output format, accounting rule, merge rules).

## 6. Decisions worth knowing

- The minted disk is `omarchy-4.0.2.iso`; HEAD is ahead. Tests target HEAD; hints tell the driver to
  check `omarchy version` / the `Super+K` row and report "absent on this build" rather than "broken".
- `VM-NO` tests live in an appendix, never in the main list. Twelve installer stories are
  `[VM-OK-from-ISO]`: runnable as soon as a ticket boots the ISO (as `mint` does).
- Disputed behaviour is settled by history (`03-INTENDED-BEHAVIOUR.md`), not by whichever side a
  reviewer read. DEFECT tests are expected to fail at HEAD; that is the point.
- The driver key set was verified in `src/qemu/keys.ts`: Print/CapsLock/Insert/right-hand modifiers
  and punctuation chords work; XF86 media/power keys do not (in-guest `wtype -k` instead); no held
  key. Several reviewers had this wrong and were corrected.
- Operator note that affects many tests: run the update once on a fresh mint and `save` that disk;
  `post-update-*` and most NET/SLOW tests assume it.

## 7. Sub-agent ids (resume with the Task tool's `resume`)

Reviewers and synthesizers are listed with ids in `00-PLAN.md` ("Reviewer sub-agents" and
"Synthesis" tables). Synthesizer ids not in that table: F1 `09f35454-923f-4df8-8778-b7b88a07542d`,
F2 `7be27ee3-da19-4598-9136-9eef5a3f96fc`, G1 `130c8be0-c099-42a2-894a-4eb80209fd6a`,
G2 `1d82d99a-5206-4aa0-a551-c53604e72ac1`, H `7ffe49cb-8d49-4a7b-8beb-12e4893d3754`,
I `43179c42-16c1-406a-9e9d-a4fcea75a775`, research `f8026abc-7b18-4bb0-ae9c-a1c3667a390a`.
