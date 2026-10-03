# Test definition wording

How an instruction is written, once the story is already chosen. `00-FORMAT.md` still decides what a
test may do. This file decides the sentences. A draft in `TESTS.md` is not finished wording. The
menu-open test took three passes before a line was fit to store.

## Read it as the driver

Read the instruction from the top and keep one line of state: menu open or closed, terminal open or
not, which workspace is showing. The result of a step has to be possible from the state left by the
step before it.

The failure that forced the second pass: after the arrow keys the menu was still open, and the next
line said Super+Space opens and then closes. The next Super+Space closes it. The one after that
opens it. Say that.

## One action, one result

Each step is one line:

```
Do this. This happens.
```

- One action. "Press Super+Space, then Super+Space again" is two steps. "Click, click again, click
  once more, then click away" is four.
- One result, and only the change. "The menu closes." "The menu opens." "Nothing opens." "A terminal
  opens." "The highlight moves down."
- Do not describe the screen. No scrim, no row lists, no header text, no icons, no "tiled," and no
  "the desktop is exactly as before" folded into the action.
- Do not explain the mechanism. Not "the chord toggles." Not "the scrim swallows the click."
- A constraint stays on the step it governs. "Use the mouse only." Not a paragraph about finding the
  logo.
- The same control may appear again. When the result is different, it is a new step.
- Keep the two closing lines: report crashes, and screenshot every step. When the machine was
  changed, "the desktop must return exactly as left" is its own last step.

The line that landed:

```
* Press Super+Space. The menu closes.
* Press Super+Space. The menu opens.
```

## Hints and proof

Hints are how to send the action: the key token (`<M-SPACE>`), where to aim the pointer, and a
timing note when a correct screen would otherwise look empty. They are not a second description of
the picture.

Proof is the list of screenshots that match the results. It is not copied back into the instruction.

## When to store

Walk the rewritten instruction once as a driver who has never seen Omarchy. If a line only makes
sense because of scenery the instruction just described, it is not done.

Store with `./ctrl test define` only after that read. A wording is a new version. It is never edited
in place. Do not store the rest of a domain because one test in it has landed.
