import { describe, expect, it } from "vitest";
import { Option } from "effect";
import * as Palette from "../src/palette.ts";
import * as Render from "../src/render.ts";

const MINUTE = 60_000;

const touchAll = (
  palette: Palette.Palette,
  agents: ReadonlyArray<string>,
  now: number,
): Palette.Palette =>
  agents.reduce((held, agent) => Palette.touch(held, agent, now).palette, palette);

const TEN = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"];

describe("palette happy path", () => {
  it("hands agents the colours in turn and keeps each one's colour on its next line", () => {
    const a = Palette.touch(Palette.empty, "A", 0);
    const b = Palette.touch(a.palette, "B", 0);
    const again = Palette.touch(b.palette, "A", MINUTE);
    expect(a.color).toBe(Render.AGENT_COLORS[0]);
    expect(b.color).toBe(Render.AGENT_COLORS[1]);
    expect(again.color).toBe(a.color);
    expect(Palette.colorOf(again.palette, "B")).toEqual(Option.some(b.color));
  });

  it("a ticket idle for an hour is dropped at the hourly trim and its colour goes to the next new one", () => {
    const full = touchAll(Palette.empty, TEN, 0);
    const active = touchAll(
      full,
      TEN.filter((agent) => agent !== "C"),
      30 * MINUTE,
    );
    const k = Palette.touch(active, "K", 61 * MINUTE);
    expect(Palette.colorOf(k.palette, "C")).toEqual(Option.none());
    expect(k.color).toBe(Palette.colorOf(full, "C").pipe(Option.getOrThrow));
    expect(Palette.colorOf(k.palette, "A")).toEqual(Palette.colorOf(full, "A"));
  });
});

describe("palette unhappy path", () => {
  it("an eleventh live agent shares a colour when every one is taken", () => {
    const full = touchAll(Palette.empty, TEN, 0);
    const k = Palette.touch(full, "K", 0);
    expect(k.color).toBe(Palette.colorOf(full, "A").pipe(Option.getOrThrow));
    expect(Palette.colorOf(k.palette, "A")).toEqual(Palette.colorOf(full, "A"));
  });

  it("an idle ticket keeps its colour until the trim, which runs once an hour", () => {
    let palette = touchAll(Palette.empty, ["A"], 0);
    palette = touchAll(palette, ["B"], 50 * MINUTE);
    palette = touchAll(palette, ["C"], 61 * MINUTE);
    expect(Palette.colorOf(palette, "A")).toEqual(Option.none());
    expect(Option.isSome(Palette.colorOf(palette, "B"))).toBe(true);
    // B has been idle 65 minutes, but the last trim was 54 minutes ago.
    palette = touchAll(palette, ["D"], 115 * MINUTE);
    expect(Option.isSome(Palette.colorOf(palette, "B"))).toBe(true);
    palette = touchAll(palette, ["E"], 121 * MINUTE);
    expect(Palette.colorOf(palette, "B")).toEqual(Option.none());
    expect(Option.isSome(Palette.colorOf(palette, "E"))).toBe(true);
  });

  it("an agent that never logged has no colour", () => {
    expect(Palette.colorOf(Palette.empty, "OLI-1")).toEqual(Option.none());
    expect(Palette.colorOf(touchAll(Palette.empty, ["A"], 0), "OLI-1")).toEqual(Option.none());
  });
});
