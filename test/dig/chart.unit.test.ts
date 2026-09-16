import { describe, expect, it } from "vitest";
import * as Chart from "../../src/dig/chart.ts";
import * as Domain from "../../src/dig/domain.ts";

describe("note chart happy path", () => {
  it("places the first note at 3 seconds so arrows wait for the lead-in", () => {
    const notes = Chart.make(7);
    expect(notes.length).toBeGreaterThan(0);
    expect(notes[0]?.id).toBe(1);
    expect(notes[0]?.hitMs).toBe(Domain.MUSIC_LEAD_MS);
    expect(Domain.DIRECTIONS.includes(notes[0]?.direction ?? "w")).toBe(true);
  });

  it("spaces later notes on the 120 bpm grid and is deterministic for a seed", () => {
    const notes = Chart.make(7);
    expect(notes[1]?.hitMs).toBe(Domain.MUSIC_LEAD_MS + Domain.BEAT_MS);
    expect(Chart.make(7)).toEqual(notes);
    expect(Chart.make(8)).not.toEqual(notes);
  });
});

describe("note chart unhappy path", () => {
  it("never emits a direction outside WASD", () => {
    const notes = Chart.make(99);
    for (const note of notes) {
      expect(Domain.DIRECTIONS).toContain(note.direction);
      expect(note.hitMs).toBeGreaterThanOrEqual(Domain.MUSIC_LEAD_MS);
    }
  });
});
