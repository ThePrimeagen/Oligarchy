# Routing pass (follow-up for every domain synthesizer)

Other synthesizers marked some of *their* source blocks as "Moved to other domains" and named your
domain. Those blocks are now yours. Your incoming list is `/tmp/omarchy-review/routing/<T>.md`
(T = your domain letter/number). Each line gives the block ref (`NN:name`), who moved it, the slice
file that holds its full text (`/tmp/omarchy-review/domains/<slice>.md` — search for `### NN:name`),
and the mover's reason, which usually names the sibling test in your file.

For each incoming block:
1. Read its full text from the slice file.
2. If your file already has the same story: fold the block's *unique* steps, caveats, negatives,
   expected strings and `covers:` into that test, and append `NN:name` to its `merged-from:`.
3. If it is a distinct story in your domain: add a new test in the standard block format
   (5–9 steps, `**` caveats, `<Hints>`, two closing bullets, round trip, `merged-from: NN:name`).
   `VM-NO` stories go under `## Not runnable here`.
4. If it genuinely belongs to neither you nor its origin, add a `## Rerouted` section with
   `- NN:name → <domain> — why` (use sparingly; the orchestrator resolves these by hand).

Also, if you have not yet applied `/home/theprimeagen/personal/oligarchy/test_def/03-INTENDED-BEHAVIOUR.md`
(it appeared after some synthesizers finished): read its summary table and the "Verdicts" section
of `01-FACTS.md`, and adjust any of your tests it touches — DEFECT / MANUAL-INTENDED items assert
the **intended** behaviour in the proof and record HEAD's behaviour as the failure to capture;
CODE-INTENDED items assert the code and say in the description that the manual disagrees.

Accounting after this pass: `|Tests merged-from| + |Not runnable merged-from| + |Moved| + |Dropped|
+ |Rerouted|` must equal `<your original slice size> + <incoming count>`, no ref listed twice.
Keep every existing section; only add or extend. Do not write anywhere else. Reply with: incoming
count, how many folded into existing tests vs new tests vs not-runnable vs rerouted, the verdict
items you applied (if any), and the new final test count by tag.
