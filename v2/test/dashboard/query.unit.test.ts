import { describe, expect, it } from "vitest";
import { definitionStats, type Session } from "../../src/dashboard/query.ts";

const session = (
  status: Session["status"],
  definitionName: string | null,
  model: string | null = null,
): Session => ({
  id: "11111111-1111-4111-8111-111111111111",
  config: { iso: "omarchy.iso" },
  status,
  reason: null,
  startedAt: new Date("2026-09-01T00:00:00Z"),
  endedAt: null,
  imageId: null,
  queriedAt: new Date("2026-09-06T00:00:00Z"),
  definitionName,
  model,
});

describe("definitionStats happy path", () => {
  it("groups the last sessions by test definition and counts succeeded and failed", () => {
    const stats = definitionStats([
      session("succeeded", "lock-screen", "grok-4.6"),
      session("failed", "lock-screen", "grok-4.6"),
      session("failed", "lock-screen", "grok-4.6"),
      session("succeeded", "install", "grok-4.6"),
      session("running", "install", "grok-4.6"),
    ]);
    expect(stats).toEqual([
      { name: "install", succeeded: 1, failed: 0, other: 1, models: ["grok-4.6"] },
      { name: "lock-screen", succeeded: 1, failed: 2, other: 0, models: ["grok-4.6"] },
    ]);
  });

  it("lists each model seen for a definition", () => {
    const stats = definitionStats([
      session("succeeded", "lock-screen", "grok-4.6"),
      session("failed", "lock-screen", "composer-2.5"),
    ]);
    expect(stats).toEqual([
      {
        name: "lock-screen",
        succeeded: 1,
        failed: 1,
        other: 0,
        models: ["composer-2.5", "grok-4.6"],
      },
    ]);
  });
});

describe("definitionStats unhappy path", () => {
  it("returns no rows when there are no sessions", () => {
    expect(definitionStats([])).toEqual([]);
  });

  it("omits sessions that are not tied to a test definition", () => {
    expect(
      definitionStats([
        session("succeeded", null, null),
        session("failed", null, "grok-4.6"),
        session("succeeded", "lock-screen", "grok-4.6"),
      ]),
    ).toEqual([{ name: "lock-screen", succeeded: 1, failed: 0, other: 0, models: ["grok-4.6"] }]);
  });
});
