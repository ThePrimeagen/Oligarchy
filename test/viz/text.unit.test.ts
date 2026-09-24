import { describe, expect, it } from "vitest";
import * as Text from "../../src/viz/text.ts";

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
