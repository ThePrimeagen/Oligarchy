import { describe, expect, it } from "vitest";
import * as Palette from "../src/palette.ts";
import * as Render from "../src/render.ts";

const MINUTE = 60_000;

const touchAll = (
  palette: Palette.Palette,
  agents: ReadonlyArray<string>,
  now: number,
): Palette.Palette =>
  agents.reduce((held, agent) => Palette.touch(held, agent, now).palette, palette);

// As many agents as there are colours.
const ALL = Render.AGENT_COLORS.map((_, index) => `OLI-${String(index)}`);

describe("the agent palette", () => {
  it("hands agents the colours in turn and keeps each one's colour on its next line (happy)", () => {
    const a = Palette.touch(Palette.empty, "A", 0);
    const b = Palette.touch(a.palette, "B", 0);
    const again = Palette.touch(b.palette, "A", MINUTE);

    expect(a.color).toBe(Render.AGENT_COLORS[0]);
    expect(b.color).toBe(Render.AGENT_COLORS[1]);
    expect(again.color).toBe(a.color);
    expect(Palette.colorOf(again.palette, "B")).toBe(b.color);
  });

  it("an agent idle for an hour is dropped at the trim and its colour goes to the next new one (happy)", () => {
    const full = touchAll(Palette.empty, ALL, 0);
    const active = touchAll(
      full,
      ALL.filter((agent) => agent !== "OLI-2"),
      30 * MINUTE,
    );
    const next = Palette.touch(active, "NEW", 61 * MINUTE);

    expect(Palette.colorOf(next.palette, "OLI-2")).toBeUndefined();
    expect(next.color).toBe(Palette.colorOf(full, "OLI-2"));
    expect(Palette.colorOf(next.palette, "OLI-0")).toBe(Palette.colorOf(full, "OLI-0"));
  });

  it("with every colour held, a new agent shares one (unhappy)", () => {
    const full = touchAll(Palette.empty, ALL, 0);
    const next = Palette.touch(full, "NEW", 0);

    expect(next.color).toBe(Palette.colorOf(full, "OLI-0"));
    expect(Palette.colorOf(next.palette, "OLI-0")).toBe(Palette.colorOf(full, "OLI-0"));
  });

  it("an idle agent keeps its colour until the trim, which runs at most once an hour (unhappy)", () => {
    let palette = touchAll(Palette.empty, ["A"], 0);
    palette = touchAll(palette, ["B"], 50 * MINUTE);
    palette = touchAll(palette, ["C"], 61 * MINUTE);
    expect(Palette.colorOf(palette, "A")).toBeUndefined();
    expect(Palette.colorOf(palette, "B")).toBeDefined();

    // B has been idle 65 minutes, but the last trim was 54 minutes ago.
    palette = touchAll(palette, ["D"], 115 * MINUTE);
    expect(Palette.colorOf(palette, "B")).toBeDefined();
    palette = touchAll(palette, ["E"], 121 * MINUTE);
    expect(Palette.colorOf(palette, "B")).toBeUndefined();
  });

  it("an agent that never logged has no colour (unhappy)", () => {
    expect(Palette.colorOf(Palette.empty, "OLI-1")).toBeUndefined();
    expect(Palette.colorOf(touchAll(Palette.empty, ["A"], 0), "OLI-1")).toBeUndefined();
  });
});
