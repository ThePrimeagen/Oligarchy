import { describe, expect, it } from "vitest";
import {
  definitionStats,
  modelStats,
  selectDefinition,
  type Session,
  type TestDefinition,
  type TestResultOutcome,
} from "../../src/dashboard/query.ts";

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

  it("lists each result's model for a definition, even when they differ", () => {
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

const outcome = (
  status: TestResultOutcome["status"],
  definitionName: string,
  model: string | null,
): TestResultOutcome => ({ definitionName, model, status });

describe("modelStats happy path", () => {
  it("groups passed and failed results by model and sorts the models", () => {
    expect(
      modelStats([
        outcome("passed", "lock-screen", "grok-4.6"),
        outcome("failed", "lock-screen", "grok-4.6"),
        outcome("failed", "lock-screen", "grok-4.6"),
        outcome("passed", "install", "composer-2.5"),
      ]),
    ).toEqual([
      { model: "composer-2.5", succeeded: 1, failed: 0 },
      { model: "grok-4.6", succeeded: 1, failed: 2 },
    ]);
  });

  it("counts one model's results across definitions when the rows are not filtered", () => {
    expect(
      modelStats([
        outcome("passed", "lock-screen", "grok-4.6"),
        outcome("failed", "install", "grok-4.6"),
      ]),
    ).toEqual([{ model: "grok-4.6", succeeded: 1, failed: 1 }]);
  });
});

describe("modelStats unhappy path", () => {
  it("returns no rows when there are no results", () => {
    expect(modelStats([])).toEqual([]);
  });

  it("omits results with no model, and statuses that are not passed or failed", () => {
    expect(
      modelStats([
        outcome("passed", "lock-screen", null),
        outcome("failed", "lock-screen", null),
        outcome("pending", "lock-screen", "grok-4.6"),
        outcome("running", "lock-screen", "grok-4.6"),
        outcome("aborted", "lock-screen", "grok-4.6"),
        outcome("timed_out", "lock-screen", "grok-4.6"),
        outcome("passed", "lock-screen", "grok-4.6"),
      ]),
    ).toEqual([{ model: "grok-4.6", succeeded: 1, failed: 0 }]);
  });

  it("omits a model that has only pending, running, aborted or timed_out results", () => {
    expect(
      modelStats([
        outcome("pending", "lock-screen", "composer-2.5"),
        outcome("timed_out", "lock-screen", "composer-2.5"),
        outcome("passed", "lock-screen", "grok-4.6"),
      ]),
    ).toEqual([{ model: "grok-4.6", succeeded: 1, failed: 0 }]);
  });
});

const definition = (id: number, name: string): TestDefinition => ({
  id,
  name,
  description: "d",
  instruction: "i",
  proof: "p",
  createdAt: new Date("2026-09-01T00:00:00Z"),
});

describe("selectDefinition happy path", () => {
  it("selects the first definition when no name is asked for", () => {
    const install = definition(1, "install");
    expect(selectDefinition([install, definition(2, "lock-screen")], undefined)).toBe(install);
  });

  it("selects the definition whose name is asked for, wherever it sits in the list", () => {
    const lock = definition(2, "lock-screen");
    expect(selectDefinition([definition(1, "install"), lock], "lock-screen")).toBe(lock);
  });
});

describe("selectDefinition unhappy path", () => {
  it("selects nothing when no definition carries exactly that name", () => {
    const definitions = [definition(1, "install"), definition(2, "lock-screen")];
    expect(selectDefinition(definitions, "wifi")).toBeUndefined();
    expect(selectDefinition(definitions, "Install")).toBeUndefined();
    expect(selectDefinition(definitions, "")).toBeUndefined();
  });

  it("selects nothing from an empty list, with or without a name", () => {
    expect(selectDefinition([], undefined)).toBeUndefined();
    expect(selectDefinition([], "install")).toBeUndefined();
  });
});
