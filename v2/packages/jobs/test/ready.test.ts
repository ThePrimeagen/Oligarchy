import * as jarl from "jarl";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MARK_BUDGET_MS, mark, release } from "../src/ready.ts";
import { fakeLinear, logging, NO_ANSWER, refused } from "./support.ts";

afterEach(() => {
  vi.useRealTimers();
});

describe("the ready label", () => {
  it("is put on the ticket once, saying nothing (happy)", async () => {
    const { linear, asked } = fakeLinear();
    const { lines, logger } = logging();

    await mark({ linear, logger }, "OLI-42");

    expect(asked).toEqual(["markReady OLI-42"]);
    expect(lines).toEqual([]);
  });

  it("refused is one attempt and one line, and the mark still returns (error)", async () => {
    const { linear, asked } = fakeLinear({
      markReady: [jarl.err(refused("linear: labeling OLI-42 ready failed"))],
    });
    const { lines, logger } = logging();

    await mark({ linear, logger }, "OLI-42");

    expect(asked).toEqual(["markReady OLI-42"]);
    expect(lines).toEqual([
      "[ERROR] [OLI-42] automation: ready label add failed: linear: labeling OLI-42 ready failed",
    ]);
  });

  it("with no answer in 3 seconds is one line, inside the webhook's deadline (error)", async () => {
    vi.useFakeTimers();
    const { linear } = fakeLinear({ markReady: [NO_ANSWER] });
    const { lines, logger } = logging();

    const marked = mark({ linear, logger }, "OLI-42");
    await vi.advanceTimersByTimeAsync(MARK_BUDGET_MS - 1);
    expect(lines).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    await marked;

    expect(lines).toEqual([
      "[ERROR] [OLI-42] automation: ready label add failed: linear: labeling OLI-42 ready failed: no answer within 3 seconds",
    ]);
  });

  it("refused twice when cleared lands on the third attempt, saying nothing (error)", async () => {
    const no = jarl.err(refused("linear: clearing OLI-42 ready failed"));
    const { linear, asked } = fakeLinear({ clearReady: [no, no] });
    const { lines, logger } = logging();

    await release({ linear, logger }, "OLI-42");

    expect(asked).toEqual(["clearReady OLI-42", "clearReady OLI-42", "clearReady OLI-42"]);
    expect(lines).toEqual([]);
  });

  it("refused three times when cleared is one line, and the release still returns (error)", async () => {
    const no = jarl.err(refused("linear: clearing OLI-42 ready failed"));
    const { linear, asked } = fakeLinear({ clearReady: [no, no, no] });
    const { lines, logger } = logging();

    await release({ linear, logger }, "OLI-42");

    expect(asked).toHaveLength(3);
    expect(lines).toEqual([
      "[ERROR] [OLI-42] automation: ready label clear failed: linear: clearing OLI-42 ready failed",
    ]);
  });
});
