import { describe, expect, it } from "vitest";
import {
  definitionStats,
  groupDefinitions,
  modelStats,
  selectDefinition,
  versionStats,
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
  definitionVersion: definitionName === null ? null : 1,
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
  definitionId = 1,
): TestResultOutcome => ({
  definitionId,
  definitionName,
  model,
  status,
  runId: "11111111-1111-4111-8111-111111111111",
  iso: "https://example.com/omarchy.iso",
  startedAt: new Date("2026-09-01T00:00:00Z"),
});

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

const definition = (id: number, name: string, instruction = "i"): TestDefinition => ({
  id,
  name,
  description: "d",
  instruction,
  proof: "p",
  createdAt: new Date("2026-09-01T00:00:00Z"),
});

// Three wordings of lock-screen (ids 2, 5, 9: the sequence has gaps) around one install.
const install = definition(3, "install");
const lockV1 = definition(2, "lock-screen", "first");
const lockV2 = definition(5, "lock-screen", "second");
const lockV3 = definition(9, "lock-screen", "third");
const ROWS = [lockV2, install, lockV3, lockV1];

describe("groupDefinitions happy path", () => {
  it("groups the rows by name, names ordered, each name's versions oldest first by id", () => {
    expect(groupDefinitions(ROWS)).toEqual([
      { name: "install", versions: [install] },
      { name: "lock-screen", versions: [lockV1, lockV2, lockV3] },
    ]);
  });

  it("numbers versions by position, so a gap in the ids is not a gap in the versions", () => {
    const [, lock] = groupDefinitions(ROWS);
    expect(lock?.versions.map((row) => row.id)).toEqual([2, 5, 9]);
    expect(lock?.versions.indexOf(lockV3)).toBe(2);
  });
});

describe("groupDefinitions unhappy path", () => {
  it("returns no groups for no rows", () => {
    expect(groupDefinitions([])).toEqual([]);
  });
});

describe("selectDefinition happy path", () => {
  it("selects the newest version of the first name when nothing is asked for", () => {
    expect(selectDefinition(groupDefinitions(ROWS), undefined, undefined)).toBe(install);
    expect(selectDefinition(groupDefinitions([lockV1, lockV2]), undefined, undefined)).toBe(lockV2);
  });

  it("selects the newest version of the name asked for, wherever it sits", () => {
    expect(selectDefinition(groupDefinitions(ROWS), "lock-screen", undefined)).toBe(lockV3);
    expect(selectDefinition(groupDefinitions(ROWS), "install", undefined)).toBe(install);
  });

  it("selects the version whose id is asked for under its name", () => {
    expect(selectDefinition(groupDefinitions(ROWS), "lock-screen", "5")).toBe(lockV2);
    expect(selectDefinition(groupDefinitions(ROWS), "lock-screen", "2")).toBe(lockV1);
  });
});

describe("selectDefinition unhappy path", () => {
  it("selects nothing when no definition carries exactly that name", () => {
    const groups = groupDefinitions(ROWS);
    expect(selectDefinition(groups, "wifi", undefined)).toBeUndefined();
    expect(selectDefinition(groups, "Install", undefined)).toBeUndefined();
    expect(selectDefinition(groups, "", undefined)).toBeUndefined();
  });

  it("selects nothing for an id that is not a version of that name", () => {
    const groups = groupDefinitions(ROWS);
    expect(selectDefinition(groups, "lock-screen", "3")).toBeUndefined();
    expect(selectDefinition(groups, "lock-screen", "7")).toBeUndefined();
    expect(selectDefinition(groups, "lock-screen", "abc")).toBeUndefined();
    expect(selectDefinition(groups, "lock-screen", "")).toBeUndefined();
  });

  it("selects nothing from no groups, whatever is asked for", () => {
    expect(selectDefinition([], undefined, undefined)).toBeUndefined();
    expect(selectDefinition([], "install", undefined)).toBeUndefined();
    expect(selectDefinition([], "install", "3")).toBeUndefined();
  });
});

describe("versionStats happy path", () => {
  it("counts passed and failed per version, oldest first, whatever the models", () => {
    expect(
      versionStats(
        [lockV1, lockV2, lockV3],
        [
          outcome("failed", "lock-screen", "grok-4.6", 2),
          outcome("failed", "lock-screen", "composer-2.5", 2),
          outcome("passed", "lock-screen", "grok-4.6", 2),
          outcome("passed", "lock-screen", "grok-4.6", 9),
          outcome("passed", "lock-screen", "grok-4.6", 9),
        ],
      ),
    ).toEqual([
      { version: 1, succeeded: 1, failed: 2 },
      { version: 3, succeeded: 2, failed: 0 },
    ]);
  });

  it("counts a result with no model: the version ran it, whoever did", () => {
    expect(versionStats([lockV1], [outcome("passed", "lock-screen", null, 2)])).toEqual([
      { version: 1, succeeded: 1, failed: 0 },
    ]);
  });
});

describe("versionStats unhappy path", () => {
  it("returns no rows when no version has a passed or failed result", () => {
    expect(versionStats([lockV1, lockV2], [])).toEqual([]);
    expect(
      versionStats(
        [lockV1, lockV2],
        [
          outcome("pending", "lock-screen", "grok-4.6", 2),
          outcome("running", "lock-screen", "grok-4.6", 5),
          outcome("aborted", "lock-screen", "grok-4.6", 5),
          outcome("timed_out", "lock-screen", "grok-4.6", 5),
        ],
      ),
    ).toEqual([]);
  });

  it("ignores results of other definitions and returns nothing for no versions", () => {
    expect(versionStats([lockV1], [outcome("passed", "install", "grok-4.6", 3)])).toEqual([]);
    expect(versionStats([], [outcome("passed", "lock-screen", "grok-4.6", 2)])).toEqual([]);
  });
});
