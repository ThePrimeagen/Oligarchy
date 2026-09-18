# Synthesis brief (read fully before starting)

You are one of 12 synthesizers. Twenty-two reviewers each proposed acceptance tests for Omarchy in
`/home/theprimeagen/personal/oligarchy/test_def/NN-*.md`. Your job: take one domain's slice of
those proposals (JSON), merge same-story duplicates from different reviewers into one final test
each, normalise everything to the spec, and write the domain's final test list. The orchestrator
concatenates the twelve final files into `TESTS.md` and builds a coverage matrix from your
`merged-from:` lines — so **every source block in your slice must be accounted for exactly once**.

## Read first

1. `/home/theprimeagen/personal/oligarchy/test_def/00-FORMAT.md` — the spec (rule zero, `./client`
   verb table, the `lock-screen` calibration, the block format).
2. `/home/theprimeagen/personal/oligarchy/test_def/01-FACTS.md` — cross-reviewer facts about the
   guest; apply them (they override individual reviewers when they conflict; each fact says which
   reviewer it corrects).
3. `/home/theprimeagen/personal/oligarchy/test_def/02-PREAMBLE.md` — driver conventions and the
   defect list; do not repeat the conventions inside every test, but do name the one or two quirks a
   given story hits.
4. If `/home/theprimeagen/personal/oligarchy/test_def/03-INTENDED-BEHAVIOUR.md` exists when you
   start (or before you finalise — check again at the end), it settles manual-vs-code disagreements:
   make the proof assert the verdict's side. If it does not exist yet, assert the code's current
   behaviour and say in the description that the manual disagrees.
5. Your slice: `/tmp/omarchy-review/domains/<DOMAIN>.md` — every source block rendered as
   `### NN:name [tags]` with `src`, `steps`, `hints=yes|NO`, `description`, optional `dedupe-with`,
   `instruction`, `proof`, `covers` (the same data is in `<DOMAIN>.json` if you prefer). It is
   large (100–300 KB): read it in chunks with offset/limit until you have seen every block. The
   cluster report
   `/tmp/omarchy-review/clusters/<DOMAIN>.txt` is a *suggestion* of same-story groups from a token
   heuristic — it over- and under-groups; use your judgement.

## What "same story" means

Two blocks are the same story when a user would describe them as one thing they did: "I switched
the theme from the menu and from the hotkey and cancelled once" is one story even if three
reviewers wrote it three ways; "I installed a theme from a bad URL and it was refused" is a
different story from "I installed a theme and its code files were dropped". A command's happy path
and its bad-argument refusal belong together unless each is long. Hardware-absence paths for
several widgets can be one story. Do not merge stories just because they share a component.

## How to write a merged test

- Pick the best source block as the base: prefer one from a file that had its compliance pass
  (`has_hints` true, 5–9 steps, closing bullets) over blocks from files 11, 25 and 42 (those were not
  normalised — if you use one, normalise it yourself: 5–9 steps, `**` caveats, `<Hints>`, the two
  closing bullets, round trip).
- Fold in the *unique* steps, caveats, negatives and proof lines of the other blocks. Drop
  repetition. Keep the exact expected strings (window classes, command outputs, error messages)
  the sources cite.
- `covers:` becomes the union of the sources' covers. Add `merged-from:` listing every source as
  `NN:name` separated by `; ` (the base first). A test made from one block still gets
  `merged-from: NN:name`.
- Name: kebab-case, unique in your file, descriptive of the story (`theme-switch-menu-and-hotkey`,
  not `theme-1`). You may keep a source name.
- Tags: main tag `VM-OK` / `VM-PARTIAL` / `VM-NO` plus `NET` / `SLOW` as applicable. If sources
  disagree, reason from 01-FACTS (e.g. audio *is* testable on the Dummy Output; Print *is* sendable).
- Every step must map to the verb table: press / type / click / screenshot / `… | sudo tee
  /dev/ttyS0` + `get-serial`. Commands typed in the guest terminal are fine. No host actions.
  Exit codes via `; echo "exit=$?"`. Prefer screenshot proofs; keep a terminal read only where the
  screen cannot show the fact.
- Round trip: the test ends with the machine as found, or says `stop` is required (disk altered).

## Output file: `/home/theprimeagen/personal/oligarchy/test_def/9<n>-final-<DOMAIN>.md`

```
# <Domain title> — final tests

<one paragraph: what this domain covers, how many source blocks → how many tests, notable merges>

## Tests

### <name>   [VM-OK] [NET]
description: ...
instruction: |
  <Instructions>
  From the desktop please do the following:

  <ActionList>
  * ...
  ** ...
  * any crashes or erroneous behavior must be reported.
  * always take a screen shot of every step
  </ActionList>

  <Hints>
  * ...
  </Hints>
  </Instructions>
proof: |
  * on success
  ** ...
  * If unsuccessful
  ** ...
covers: <union>
merged-from: NN:name; NN:name

...

## Not runnable here

<same block format for every VM-NO test; keep `[VM-OK-from-ISO]` sub-tags where sources had them>

## Moved to other domains

- NN:name → <DOMAIN letter> — <why>   (blocks that clearly belong elsewhere; do not rewrite them)

## Dropped

- NN:name — <reason: e.g. pure file inspection with no user story; duplicate of NN:name already
  merged; not a user behaviour>   (use sparingly; a dropped block's coverage must be justified)
```

Accounting rule: `|Tests merged-from| + |Not runnable merged-from| + |Moved| + |Dropped|` must equal
the number of blocks in your slice, with no block listed twice. The orchestrator checks this
mechanically; say the four numbers in your reply.

## Calibration example (domain E, decided by the orchestrator)

- `theme-switch-menu-and-hotkey` ← 21:theme-switch-menu (base); 21:theme-switch-hotkey;
  10:theme-picker-hotkey-apply-and-cancel; 31:menu-theme-switch-image-picker;
  21:theme-picker-cancel-keeps-theme; 50:style-selectors-preview-and-cancel
- `background-picker-select-and-cancel` ← 32:… (base); 10:background-picker-and-cycle;
  21:background-switcher-hotkey-and-menu; 31:menu-background-switcher-apply-and-cancel
- `theme-install-git-url-drops-code-files` ← 21:theme-install-local-git-repo-filters-code (base,
  offline via a local `git init` repo); 12:…; 52:…; 60:theme-install-drops-code-files; 61:…
- `theme-concurrent-switch-serialises` — kept alone (distinct story).
- `menu-root-walk-bar-position-left` (50) — *moved* to B: it tests keyboard-only menu navigation,
  not bar styling.
- 11:rsync-watchers, 41:man-pages-render-through-bat — *moved* to H (shell functions).

## Do not

- Do not write anywhere except your output file.
- Do not invent behaviour: every step and expected string must come from a source block or from
  01-FACTS / 03-INTENDED-BEHAVIOUR.
- Do not drop a negative path to save space; fold it into the story as a `**` caveat or a final step.
