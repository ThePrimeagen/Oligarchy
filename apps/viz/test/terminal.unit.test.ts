import { describe, expect, it } from "vitest";
import * as Terminal from "../src/terminal.ts";

describe("speaksKitty", () => {
  it("is true for a tmux client termtype naming ghostty or kitty, in any case (happy)", () => {
    expect(
      ["ghostty 1.3.1", "xterm-kitty", "Ghostty", "XTERM-KITTY"].map(Terminal.speaksKitty),
    ).toEqual([true, true, true, true]);
  });

  it("is false for any other terminal and for an empty termtype (unhappy)", () => {
    expect(["xterm-256color", "iTerm2 3.5", "tmux-256color", ""].map(Terminal.speaksKitty)).toEqual(
      [false, false, false, false],
    );
  });
});
