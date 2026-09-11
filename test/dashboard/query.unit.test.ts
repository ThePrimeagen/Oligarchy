import { describe, expect, it } from "vitest";
import {
  definitionStats,
  durationChart,
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

const at = (iso: string): Date => new Date(iso);

const outcome = (
  status: TestResultOutcome["status"],
  model: string | null,
  definitionId = 1,
  times: {
    readonly startedAt?: Date;
    readonly createdAt?: Date;
    readonly finishedAt?: Date | null;
    readonly sessionStartedAt?: Date | null;
    readonly sessionEndedAt?: Date | null;
  } = {},
): TestResultOutcome => ({
  definitionId,
  model,
  status,
  runId: "11111111-1111-4111-8111-111111111111",
  iso: "https://example.com/omarchy.iso",
  startedAt: times.startedAt ?? at("2026-09-01T00:00:00Z"),
  createdAt: times.createdAt ?? at("2026-09-01T00:00:00Z"),
  finishedAt: times.finishedAt === undefined ? at("2026-09-01T00:01:00Z") : times.finishedAt,
  sessionStartedAt: times.sessionStartedAt ?? null,
  sessionEndedAt: times.sessionEndedAt ?? null,
});

describe("modelStats happy path", () => {
  it("groups passed and failed results by model and sorts the models", () => {
    expect(
      modelStats([
        outcome("passed", "grok-4.6"),
        outcome("failed", "grok-4.6"),
        outcome("failed", "grok-4.6"),
        outcome("passed", "composer-2.5"),
      ]),
    ).toEqual([
      { model: "composer-2.5", succeeded: 1, failed: 0 },
      { model: "grok-4.6", succeeded: 1, failed: 2 },
    ]);
  });

  it("counts one model's results across definitions when the rows are not filtered", () => {
    expect(modelStats([outcome("passed", "grok-4.6"), outcome("failed", "grok-4.6")])).toEqual([
      { model: "grok-4.6", succeeded: 1, failed: 1 },
    ]);
  });
});

describe("modelStats unhappy path", () => {
  it("returns no rows when there are no results", () => {
    expect(modelStats([])).toEqual([]);
  });

  it("omits results with no model, and statuses that are not passed or failed", () => {
    expect(
      modelStats([
        outcome("passed", null),
        outcome("failed", null),
        outcome("pending", "grok-4.6"),
        outcome("running", "grok-4.6"),
        outcome("aborted", "grok-4.6"),
        outcome("timed_out", "grok-4.6"),
        outcome("passed", "grok-4.6"),
      ]),
    ).toEqual([{ model: "grok-4.6", succeeded: 1, failed: 0 }]);
  });

  it("omits a model that has only pending, running, aborted or timed_out results", () => {
    expect(
      modelStats([
        outcome("pending", "composer-2.5"),
        outcome("timed_out", "composer-2.5"),
        outcome("passed", "grok-4.6"),
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
  it("selects the first name, with every one of its versions, when nothing is asked for", () => {
    const [first] = groupDefinitions(ROWS);
    expect(selectDefinition(groupDefinitions(ROWS), undefined)).toEqual(first);
    expect(selectDefinition(groupDefinitions([lockV2, lockV1]), undefined)).toEqual({
      name: "lock-screen",
      versions: [lockV1, lockV2],
    });
  });

  it("selects the name asked for, wherever it sits, with every one of its versions", () => {
    expect(selectDefinition(groupDefinitions(ROWS), "lock-screen")).toEqual({
      name: "lock-screen",
      versions: [lockV1, lockV2, lockV3],
    });
    expect(selectDefinition(groupDefinitions(ROWS), "install")).toEqual({
      name: "install",
      versions: [install],
    });
  });
});

describe("selectDefinition unhappy path", () => {
  it("selects nothing when no definition carries exactly that name", () => {
    const groups = groupDefinitions(ROWS);
    expect(selectDefinition(groups, "wifi")).toBeUndefined();
    expect(selectDefinition(groups, "Install")).toBeUndefined();
    expect(selectDefinition(groups, "")).toBeUndefined();
  });

  it("selects nothing from no groups, with or without a name", () => {
    expect(selectDefinition([], undefined)).toBeUndefined();
    expect(selectDefinition([], "install")).toBeUndefined();
  });
});

describe("versionStats happy path", () => {
  it("counts passed and failed per version, oldest first, whatever the models", () => {
    expect(
      versionStats(
        [lockV1, lockV2, lockV3],
        [
          outcome("failed", "grok-4.6", 2),
          outcome("failed", "composer-2.5", 2),
          outcome("passed", "grok-4.6", 2),
          outcome("passed", "grok-4.6", 9),
          outcome("passed", "grok-4.6", 9),
        ],
      ),
    ).toEqual([
      { version: 1, succeeded: 1, failed: 2 },
      { version: 3, succeeded: 2, failed: 0 },
    ]);
  });

  it("counts a result with no model: the version ran it, whoever did", () => {
    expect(versionStats([lockV1], [outcome("passed", null, 2)])).toEqual([
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
          outcome("pending", "grok-4.6", 2),
          outcome("running", "grok-4.6", 5),
          outcome("aborted", "grok-4.6", 5),
          outcome("timed_out", "grok-4.6", 5),
        ],
      ),
    ).toEqual([]);
  });

  it("ignores results of other definitions and returns nothing for no versions", () => {
    expect(versionStats([lockV1], [outcome("passed", "grok-4.6", 3)])).toEqual([]);
    expect(versionStats([], [outcome("passed", "grok-4.6", 2)])).toEqual([]);
  });
});

const timed = (
  status: "passed" | "failed",
  finishedAt: Date,
  durationMs: number,
  definitionId = 1,
): TestResultOutcome =>
  outcome(status, "grok-4.6", definitionId, {
    createdAt: new Date(finishedAt.getTime() - durationMs),
    finishedAt,
  });

describe("durationChart happy path", () => {
  it("keeps the newest 50 passed or failed runs, then sorts them shortest duration first", () => {
    const olderShort = timed("passed", at("2026-09-01T00:00:00Z"), 1_000);
    const newerLong = timed("failed", at("2026-09-01T00:10:00Z"), 4_000);
    const newestMid = timed("passed", at("2026-09-01T00:20:00Z"), 2_000);
    expect(durationChart([newerLong, olderShort, newestMid])).toEqual({
      bars: [
        { ms: 1_000, succeeded: true },
        { ms: 2_000, succeeded: true },
        { ms: 4_000, succeeded: false },
      ],
      percentiles: { p10: 1_000, p25: 1_000, p50: 2_000, p75: 4_000, p90: 4_000, p99: 4_000 },
    });
  });

  it("uses the session's duration when the session has both stamps", () => {
    const row = outcome("passed", "grok-4.6", 1, {
      createdAt: at("2026-09-01T00:00:00Z"),
      finishedAt: at("2026-09-01T00:10:00Z"),
      sessionStartedAt: at("2026-09-01T00:01:00Z"),
      sessionEndedAt: at("2026-09-01T00:03:00Z"),
    });
    expect(durationChart([row])).toEqual({
      bars: [{ ms: 120_000, succeeded: true }],
      percentiles: {
        p10: 120_000,
        p25: 120_000,
        p50: 120_000,
        p75: 120_000,
        p90: 120_000,
        p99: 120_000,
      },
    });
  });

  it("drops the oldest run once more than 50 have a duration", () => {
    const rows = Array.from({ length: 51 }, (_, index) =>
      timed(
        index % 2 === 0 ? "passed" : "failed",
        at(`2026-09-01T00:${String(index).padStart(2, "0")}:00Z`),
        (index + 1) * 1_000,
      ),
    );
    const chart = durationChart(rows);
    expect(chart.bars).toHaveLength(50);
    // The oldest finished first and was 1s; the remaining 50 start at 2s and end at 51s.
    expect(chart.bars[0]).toEqual({ ms: 2_000, succeeded: false });
    expect(chart.bars[49]).toEqual({ ms: 51_000, succeeded: true });
    expect(chart.percentiles).toEqual({
      p10: 6_000,
      p25: 14_000,
      p50: 26_000,
      p75: 39_000,
      p90: 46_000,
      p99: 51_000,
    });
  });
});

describe("durationChart unhappy path", () => {
  it("returns no bars when nothing passed or failed with a duration", () => {
    expect(durationChart([])).toEqual({ bars: [], percentiles: undefined });
    expect(
      durationChart([
        outcome("pending", "grok-4.6", 1, { finishedAt: null }),
        outcome("running", "grok-4.6", 1, { finishedAt: null }),
        outcome("aborted", "grok-4.6", 1, {
          createdAt: at("2026-09-01T00:00:00Z"),
          finishedAt: at("2026-09-01T00:01:00Z"),
        }),
        outcome("timed_out", "grok-4.6", 1, {
          createdAt: at("2026-09-01T00:00:00Z"),
          finishedAt: at("2026-09-01T00:01:00Z"),
        }),
        outcome("passed", "grok-4.6", 1, { finishedAt: null }),
      ]),
    ).toEqual({ bars: [], percentiles: undefined });
  });

  it("omits a run whose finish is before its start", () => {
    expect(
      durationChart([
        outcome("passed", "grok-4.6", 1, {
          createdAt: at("2026-09-01T00:02:00Z"),
          finishedAt: at("2026-09-01T00:01:00Z"),
        }),
        outcome("failed", "grok-4.6", 1, {
          sessionStartedAt: at("2026-09-01T00:02:00Z"),
          sessionEndedAt: at("2026-09-01T00:01:00Z"),
          finishedAt: null,
        }),
      ]),
    ).toEqual({ bars: [], percentiles: undefined });
  });
});
