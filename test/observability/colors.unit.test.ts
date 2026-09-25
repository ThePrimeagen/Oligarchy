import { describe, expect, it } from "vitest";
import * as Colors from "../../src/observability/colors.ts";

describe("wantsColor", () => {
  it("is false without a TTY and without FORCE_COLOR", () => {
    expect(Colors.wantsColor({ isTTY: false, hasColors: () => true }, {})).toBe(false);
    expect(Colors.wantsColor({}, {})).toBe(false);
  });

  it("is true with FORCE_COLOR=1 when 16 colours are supported", () => {
    expect(
      Colors.wantsColor({ isTTY: false, hasColors: (n) => n <= 16 }, { FORCE_COLOR: "1" }),
    ).toBe(true);
  });

  it("is true on a TTY that supports 16 colours", () => {
    expect(Colors.wantsColor({ isTTY: true, hasColors: (n) => n <= 16 }, {})).toBe(true);
  });

  it("is false when the stream cannot render 16 colours", () => {
    expect(Colors.wantsColor({ isTTY: true, hasColors: () => false }, { FORCE_COLOR: "1" })).toBe(
      false,
    );
  });

  // A piped stdout is a plain stream with no hasColors of its own, on Bun as on Node.
  it("falls back to the runtime's colour depth when the stream has no hasColors", () => {
    expect(Colors.wantsColor({ isTTY: false }, { FORCE_COLOR: "1" })).toBe(true);
    expect(Colors.wantsColor({ isTTY: false }, { FORCE_COLOR: "0" })).toBe(false);
  });
});
