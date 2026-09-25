import { describe, expect, it } from "vitest";
import { Option } from "effect";
import type * as Text from "../../src/viz/text.ts";
import * as Trail from "../../src/viz/trail.ts";
import { QUERIED_AT, SESSION_ID } from "../support/viz.ts";

const T = QUERIED_AT.getTime();
const WIDTH = 40;
const GLYPH = "⠋";
const at = (ms: number): Date => new Date(T + ms);
const textOf = (row: Text.Row): string => row.map((piece) => piece.text).join("");
// An action row: the mark and the name, how long it took at the right edge.
const timed = (left: string, took: string): string => `${left.padEnd(WIDTH - took.length)}${took}`;

const started = (message: string, ms: number) => ({
  text: `intent start; ${message}`,
  createdAt: at(ms),
});
const ended = (ms: number) => ({ text: "intent end", createdAt: at(ms) });
const action = (id: number, execute: string, start: number, end: number | null) => ({
  id,
  request: { execute },
  state: end === null ? null : ("completed" as const),
  createdAt: at(start),
  finishedAt: end === null ? null : at(end),
});

const trail = (intents: Trail.Trail["intents"], actions: Trail.Trail["actions"]): Trail.Trail => ({
  sessionId: SESSION_ID,
  intents,
  actions,
  image: Option.none(),
});

// Two steps: the first closed with two actions under it, the second open with two more.
const twoSteps = trail(
  [started("Press Super+Escape.", 0), ended(5_000), started("Click Lock.", 5_100)],
  [
    action(1, "send-key", 100, 400),
    action(2, "screendump", 2_000, 2_200),
    action(3, "input-send-event", 5_200, 5_300),
    action(4, "screendump", 8_000, 8_200),
  ],
);

describe("trail happy path", () => {
  it("lists the newest step first, its newest action first, and the processing that led to each action below it", () => {
    expect(Trail.rows(twoSteps, T + 9_000, true, GLYPH, WIDTH, 20).map(textOf)).toEqual([
      `${GLYPH} Click Lock.`,
      timed("  · processing", "0.8s"),
      timed("  ✓ screendump", "0.2s"),
      timed("  · processing", "2.7s"),
      timed("  ✓ input-send-event", "0.1s"),
      timed("  · processing", "3.0s"),
      "✓ Press Super+Escape.",
      timed("  ✓ screendump", "0.2s"),
      timed("  · processing", "1.6s"),
      timed("  ✓ send-key", "0.3s"),
    ]);
  });

  it("a running action spins and counts up, with no processing above it", () => {
    const running = trail(twoSteps.intents, [
      ...twoSteps.actions,
      action(5, "input-send-event", 9_500, null),
    ]);
    expect(
      Trail.rows(running, T + 10_000, true, GLYPH, WIDTH, 20)
        .map(textOf)
        .slice(0, 3),
    ).toEqual([
      `${GLYPH} Click Lock.`,
      timed(`  ${GLYPH} input-send-event`, "0.5s"),
      timed("  · processing", "1.3s"),
    ]);
  });

  it("stops at the pane's height, keeping the newest", () => {
    expect(Trail.rows(twoSteps, T + 9_000, true, GLYPH, WIDTH, 3).map(textOf)).toEqual([
      `${GLYPH} Click Lock.`,
      timed("  · processing", "0.8s"),
      timed("  ✓ screendump", "0.2s"),
    ]);
  });

  it("wraps the newest step so its words stay, and cuts an older one to its row", () => {
    const long = "Click Lock. Use the mouse only. The screen locks.";
    const wordy = trail(
      [started(long, 0), ended(1_000), started(long, 1_100)],
      [action(1, "screendump", 200, 300)],
    );
    const rows = Trail.rows(wordy, T + 2_000, true, GLYPH, WIDTH, 20).map(textOf);
    expect(rows[0]).toBe(`${GLYPH} Click Lock. Use the mouse only. The`);
    expect(rows[1]).toBe("  screen locks.");
    const older = rows.find((row) => row.startsWith("✓ "));
    expect(older).toHaveLength(WIDTH);
    expect(older?.endsWith("…")).toBe(true);
  });

  it("names every step said while the newest is open, so the row can place it", () => {
    expect(Trail.steps(twoSteps, true)).toEqual(["Press Super+Escape.", "Click Lock."]);
  });
});

describe("trail unhappy path", () => {
  it("a session that is over spins nothing, counts no processing, and marks an action left unfinished failed without a time", () => {
    const over = trail(twoSteps.intents, [
      ...twoSteps.actions,
      action(5, "input-send-event", 9_500, null),
    ]);
    const rows = Trail.rows(over, T + 60_000, false, GLYPH, WIDTH, 20).map(textOf);
    expect(rows.slice(0, 3)).toEqual([
      "✓ Click Lock.",
      "  ✗ input-send-event",
      timed("  · processing", "1.3s"),
    ]);
    expect(rows.join("\n")).not.toContain(GLYPH);
  });

  it("actions sent before any step stand on their own", () => {
    const bare = trail(
      [],
      [action(1, "send-key", 100, 400), action(2, "screendump", 2_000, 2_200)],
    );
    expect(Trail.rows(bare, T + 3_000, false, GLYPH, WIDTH, 20).map(textOf)).toEqual([
      timed("✓ screendump", "0.2s"),
      timed("· processing", "1.6s"),
      timed("✓ send-key", "0.3s"),
    ]);
  });

  it("a session with nothing yet has no rows", () => {
    expect(Trail.rows(trail([], []), T, true, GLYPH, WIDTH, 20)).toEqual([]);
  });

  it("names no step once the newest has ended, or once the session is over", () => {
    const closed = trail([...twoSteps.intents, ended(9_000)], twoSteps.actions);
    expect(Trail.steps(closed, true)).toEqual([]);
    expect(Trail.steps(twoSteps, false)).toEqual([]);
    expect(Trail.rows(closed, T + 9_500, true, GLYPH, WIDTH, 1).map(textOf)).toEqual([
      "✓ Click Lock.",
    ]);
  });
});
