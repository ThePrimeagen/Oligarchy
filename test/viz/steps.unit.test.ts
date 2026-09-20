import { describe, expect, it } from "vitest";
import * as Steps from "../../src/viz/steps.ts";

// The shape every newest wording uses. The last two bullets are the crash report and the
// screenshot line; the desktop line is a real step and stays.
const LIST = `<Instructions>
From the desktop please do the following:

<ActionList>
* Press Super+Escape. The System menu opens.
* Click Lock. Use the mouse only. The screen locks.
* the desktop must return exactly as left.
* any crashes or erroneous behavior must be reported.
* always take a screen shot of every step
</ActionList>

<Hints>
* Super+Escape is <M-ESC>.
</Hints>
</Instructions>`;

const STEPS = [
  "Press Super+Escape. The System menu opens.",
  "Click Lock. Use the mouse only. The screen locks.",
  "the desktop must return exactly as left.",
];

describe("steps happy path", () => {
  it("counts ActionList bullets and drops the crash report and the screenshot line", () => {
    expect(Steps.stepsOf(LIST)).toEqual(STEPS);
  });

  it("drops a trailing crash line when the list has no screenshot line", () => {
    const crashOnly = `<ActionList>
* Press Super+W. The terminal closes.
* Any crash or erroneous behavior must be reported.
</ActionList>`;
    expect(Steps.stepsOf(crashOnly)).toEqual(["Press Super+W. The terminal closes."]);
  });

  it("places a step by its exact line, and still places one copied with its asterisk", () => {
    expect(Steps.indexOf(STEPS, "Click Lock. Use the mouse only. The screen locks.")).toBe(2);
    expect(Steps.indexOf(STEPS, "* the desktop must return exactly as left.")).toBe(3);
    expect(Steps.indexOf(STEPS, "  Press Super+Escape. The System menu opens.  ")).toBe(1);
  });
});

describe("steps unhappy path", () => {
  it("has no steps when the instruction has no ActionList", () => {
    expect(Steps.stepsOf("Press Super+L")).toEqual([]);
    expect(Steps.stepsOf("<ActionList>not a bullet</ActionList>")).toEqual([]);
    expect(Steps.indexOf([], "Press Super+L")).toBe(0);
  });

  it("does not place a paraphrase, an empty message, or a hint", () => {
    expect(Steps.indexOf(STEPS, "lock the screen")).toBe(0);
    expect(Steps.indexOf(STEPS, "")).toBe(0);
    expect(Steps.indexOf(STEPS, "always take a screen shot of every step")).toBe(0);
    expect(Steps.indexOf(STEPS, "any crashes or erroneous behavior must be reported.")).toBe(0);
    expect(Steps.indexOf(STEPS, "Super+Escape is <M-ESC>.")).toBe(0);
  });
});
