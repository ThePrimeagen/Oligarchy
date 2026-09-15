import { describe, expect, it } from "vitest";
import * as Domain from "../../src/dig/domain.ts";
import * as Timing from "../../src/dig/timing.ts";

describe("WASD hit windows happy path", () => {
  it("scores perfect at the hit instant and at the 50 ms edges", () => {
    expect(Timing.judge(0, "w", "w")).toBe("perfect");
    expect(Timing.judge(Domain.PERFECT_WINDOW_MS, "a", "a")).toBe("perfect");
    expect(Timing.judge(-Domain.PERFECT_WINDOW_MS, "s", "s")).toBe("perfect");
  });

  it("scores okay between 50 ms and 100 ms", () => {
    expect(Timing.judge(Domain.PERFECT_WINDOW_MS + 1, "d", "d")).toBe("okay");
    expect(Timing.judge(Domain.OKAY_WINDOW_MS, "w", "w")).toBe("okay");
    expect(Timing.judge(-Domain.OKAY_WINDOW_MS, "a", "a")).toBe("okay");
  });
});

describe("WASD hit windows unhappy path", () => {
  it("scores a miss outside 100 ms even with the right key", () => {
    expect(Timing.judge(Domain.OKAY_WINDOW_MS + 1, "w", "w")).toBe("miss");
    expect(Timing.judge(-(Domain.OKAY_WINDOW_MS + 1), "s", "s")).toBe("miss");
  });

  it("scores a miss for the wrong direction even at the hit instant", () => {
    expect(Timing.judge(0, "w", "s")).toBe("miss");
    expect(Timing.judge(0, "a", "d")).toBe("miss");
  });
});
