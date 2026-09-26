import { describe, expect, it } from "vitest";
import * as Text from "../src/text.ts";

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

describe("countup", () => {
  it("under a minute is seconds alone", () => {
    expect(Text.count(45 * SECOND)).toBe("45s");
  });

  it("under an hour is minutes and seconds", () => {
    expect(Text.count(10 * MINUTE + 31 * SECOND)).toBe("10m 31s");
    expect(Text.count(59 * MINUTE)).toBe("59m 0s");
  });

  it("past an hour is hours and minutes, the seconds dropped", () => {
    expect(Text.count(HOUR + 5 * MINUTE + 59 * SECOND)).toBe("1h 5m");
  });

  it("a start stamped just ahead of the read is 0s, never negative (unhappy)", () => {
    expect(Text.count(-2 * SECOND)).toBe("0s");
  });
});

describe("elapsed", () => {
  it("is tenths of a second under a minute, then minutes and seconds", () => {
    expect(Text.elapsed(300)).toBe("0.3s");
    expect(Text.elapsed(4_200)).toBe("4.2s");
    expect(Text.elapsed(59_990)).toBe("59.9s");
    expect(Text.elapsed(MINUTE + 3 * SECOND)).toBe("1m 3s");
  });

  it("a gap that comes out negative is 0.0s (unhappy)", () => {
    expect(Text.elapsed(-50)).toBe("0.0s");
  });
});
