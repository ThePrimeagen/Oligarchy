import { describe, expect, it } from "vitest";
import { Encoding } from "effect";
import * as Placeholder from "../../src/viz/placeholder.ts";
import { TINY_PNG } from "../support/viz.ts";

const PLACEHOLDER = "\u{10EEEE}";
const wrapped = (sequence: string): ReadonlyArray<string> => sequence.split("\x1bPtmux;").slice(1);

describe("placeholder", () => {
  it("transmits a screenshot as a virtual placement, quiet, through tmux, with no cursor address", () => {
    const sequence = Placeholder.show(TINY_PNG, Placeholder.PEEK, 10, 3);
    expect(sequence.startsWith("\x1bPtmux;\x1b\x1b_G")).toBe(true);
    expect(sequence).toContain("a=t,f=100,i=2,m=0,q=2;");
    expect(sequence).toContain(Encoding.encodeBase64(TINY_PNG));
    expect(sequence).toContain("a=p,U=1,i=2,c=10,r=3,q=2");
    expect(sequence).not.toContain("a=T");
    expect(sequence).not.toContain("\x1b[");
    expect(wrapped(sequence)).toHaveLength(2);
  });

  it("splits a payload bigger than one chunk and marks every chunk but the last as more", () => {
    const png = new Uint8Array(3073);
    png[0] = 1;
    png[3072] = 2;
    const sequence = Placeholder.show(png, Placeholder.SESSION, 4, 5);
    const commands = wrapped(sequence);
    expect(commands).toHaveLength(3);
    expect(commands[0]).toContain("m=1,q=2;");
    expect(commands[0]).toContain(Encoding.encodeBase64(png.subarray(0, 3072)));
    expect(commands[1]).toContain("m=0,q=2;");
    expect(commands[1]).toContain(Encoding.encodeBase64(png.subarray(3072)));
    expect(commands[1]).not.toContain(Encoding.encodeBase64(png.subarray(0, 3072)));
    expect(commands[2]).toContain("a=p,U=1,i=1,c=4,r=5,q=2");
  });

  it("deletes the image by id, quiet, through tmux", () => {
    const sequence = Placeholder.hide(Placeholder.FULL);
    expect(sequence).toBe("\x1bPtmux;\x1b\x1b_Ga=d,d=I,i=3,q=2\x1b\x1b\\\x1b\\");
    expect(sequence).not.toContain("\x1b[");
  });

  it("names each cell with the placeholder and its row and column diacritics", () => {
    const grid = Placeholder.lines(2, 2);
    expect(grid).toEqual([
      `${PLACEHOLDER}\u0305\u0305${PLACEHOLDER}\u0305\u030d`,
      `${PLACEHOLDER}\u030d\u0305${PLACEHOLDER}\u030d\u030d`,
    ]);
    expect(Placeholder.color(Placeholder.SESSION)).toBe("#000001");
    expect(Placeholder.color(Placeholder.PEEK)).toBe("#000002");
    expect(Placeholder.color(Placeholder.FULL)).toBe("#000003");
  });

  it("refuses an empty screenshot and a grid the diacritics cannot name", () => {
    expect(Placeholder.fits(1, 1)).toBe(true);
    expect(Placeholder.fits(Placeholder.MAX_SPAN, Placeholder.MAX_SPAN)).toBe(true);
    expect(Placeholder.fits(0, 1)).toBe(false);
    expect(Placeholder.fits(1, 0)).toBe(false);
    expect(Placeholder.fits(Placeholder.MAX_SPAN + 1, 1)).toBe(false);
    expect(Placeholder.fits(1, Placeholder.MAX_SPAN + 1)).toBe(false);
    expect(Placeholder.show(new Uint8Array(), Placeholder.SESSION, 1, 1)).toBe("");
    expect(Placeholder.show(TINY_PNG, Placeholder.SESSION, 0, 1)).toBe("");
    expect(Placeholder.show(TINY_PNG, Placeholder.SESSION, Placeholder.MAX_SPAN + 1, 1)).toBe("");
  });
});
