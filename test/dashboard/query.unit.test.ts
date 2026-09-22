import { describe, expect, it } from "vitest";
import {
  FOLLOW_LIMIT,
  actionName,
  definitionHistories,
  definitionStats,
  failureDiagnosis,
  recentDefinitionRuns,
  resultDurationMs,
  orderSuites,
  runningForDefinition,
  durationChart,
  followEvents,
  groupDefinitions,
  groupProcessSeries,
  modelStats,
  selectDefinition,
  versionStats,
  type AutomationJob,
  type DefinitionRunSource,
  type FollowAction,
  type FollowLog,
  type ProcessStat,
  type Session,
  type SuiteRow,
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

const historyRow = (
  name: string,
  status: TestResultOutcome["status"],
  at: number,
  extra: { readonly reason?: string | null; readonly model?: string | null } = {},
) => ({
  name,
  id: `${name}:${at}`,
  status,
  at,
  reason: extra.reason ?? null,
  model: extra.model ?? null,
});

const shown = (
  name: string,
  status: "passed" | "failed" | "running",
  at: number,
  extra: { readonly reason?: string | null; readonly model?: string | null } = {},
) => ({
  id: `${name}:${at}`,
  status,
  at,
  reason: extra.reason ?? null,
  model: extra.model ?? null,
});

describe("definitionHistories happy path", () => {
  it("counts passes out of passes and fails, oldest of the run first", () => {
    const rows = [historyRow("lock-screen", "failed", 17), historyRow("lock-screen", "failed", 16)];
    for (let at = 15; at >= 1; at -= 1) {
      rows.push(historyRow("lock-screen", "passed", at));
    }
    expect(definitionHistories(rows)).toEqual([
      {
        name: "lock-screen",
        passed: 15,
        total: 17,
        recent: [
          ...Array.from({ length: 15 }, (_, index) => shown("lock-screen", "passed", index + 1)),
          shown("lock-screen", "failed", 16),
          shown("lock-screen", "failed", 17),
        ],
      },
    ]);
  });

  it("keeps each definition's rate and puts only its newest twenty-five on the strip", () => {
    const rows = [];
    for (let at = 1; at <= 5; at += 1) {
      rows.push(historyRow("lock-screen", "failed", at));
    }
    for (let at = 6; at <= 30; at += 1) {
      rows.push(historyRow("lock-screen", "passed", at));
    }
    rows.push(historyRow("install", "passed", 1), historyRow("install", "failed", 2));
    expect(definitionHistories(rows)).toEqual([
      {
        name: "install",
        passed: 1,
        total: 2,
        recent: [shown("install", "passed", 1), shown("install", "failed", 2)],
      },
      {
        name: "lock-screen",
        passed: 25,
        total: 30,
        recent: Array.from({ length: 25 }, (_, index) => shown("lock-screen", "passed", index + 6)),
      },
    ]);
  });
});

describe("definitionHistories unhappy path", () => {
  it("returns nothing when there are no results", () => {
    expect(definitionHistories([])).toEqual([]);
  });

  it("keeps a running result on the strip and out of the rate, and drops pending, aborted and timed out", () => {
    expect(
      definitionHistories([
        historyRow("lock-screen", "pending", 1),
        historyRow("lock-screen", "running", 2, { model: "grok-4.6" }),
        historyRow("lock-screen", "aborted", 3),
        historyRow("lock-screen", "timed_out", 4),
        historyRow("lock-screen", "passed", 5),
        historyRow("lock-screen", "failed", 6, { reason: "the screen stayed unlocked" }),
        historyRow("install", "timed_out", 1),
        historyRow("install", "aborted", 2),
      ]),
    ).toEqual([
      {
        name: "lock-screen",
        passed: 1,
        total: 2,
        recent: [
          shown("lock-screen", "running", 2, { model: "grok-4.6" }),
          shown("lock-screen", "passed", 5),
          shown("lock-screen", "failed", 6, { reason: "the screen stayed unlocked" }),
        ],
      },
    ]);
  });

  it("still lists a definition that is only running, and does not call that zero out of zero", () => {
    expect(
      definitionHistories([
        historyRow("lock-screen", "running", 4, { model: "grok-4.6" }),
        historyRow("lock-screen", "pending", 5),
      ]),
    ).toEqual([
      {
        name: "lock-screen",
        passed: 0,
        total: 0,
        recent: [shown("lock-screen", "running", 4, { model: "grok-4.6" })],
      },
    ]);
  });

  it("drops a running result that falls outside the newest twenty-five and does not count it", () => {
    const rows = [historyRow("lock-screen", "running", 1)];
    for (let at = 2; at <= 26; at += 1) {
      rows.push(historyRow("lock-screen", "passed", at));
    }
    expect(definitionHistories(rows)).toEqual([
      {
        name: "lock-screen",
        passed: 25,
        total: 25,
        recent: Array.from({ length: 25 }, (_, index) => shown("lock-screen", "passed", index + 2)),
      },
    ]);
  });
});

const source = (
  id: string,
  status: DefinitionRunSource["status"],
  at: number,
  extra: {
    readonly durationMs?: number | null;
    readonly errorType?: string | null;
    readonly summary?: string | null;
    readonly reason?: string | null;
  } = {},
): DefinitionRunSource => ({
  id,
  status,
  at,
  durationMs: extra.durationMs ?? null,
  errorType: extra.errorType ?? null,
  summary: extra.summary ?? null,
  reason: extra.reason ?? null,
});

describe("recentDefinitionRuns happy path", () => {
  it("keeps the newest ten verdicts, a pass's time, and a fail's diagnosis", () => {
    const rows = [
      source("pass-old", "passed", 1, { durationMs: 1_000 }),
      source("pass-mid", "passed", 2, { durationMs: 2_000, summary: "ignored on a pass" }),
    ];
    for (let at = 3; at <= 11; at += 1) {
      rows.push(source(`pass-${String(at)}`, "passed", at, { durationMs: at * 1_000 }));
    }
    rows.push(
      source("fail-new", "failed", 12, {
        durationMs: 9_000,
        errorType: "unlocked",
        summary: "the screen stayed unlocked",
        reason: "driver gave up",
      }),
    );
    expect(recentDefinitionRuns(rows)).toEqual([
      {
        id: "fail-new",
        status: "failed",
        durationMs: null,
        diagnosis: "unlocked: the screen stayed unlocked",
      },
      ...Array.from({ length: 9 }, (_, index) => ({
        id: `pass-${String(11 - index)}`,
        status: "passed" as const,
        durationMs: (11 - index) * 1_000,
        diagnosis: null,
      })),
    ]);
  });
});

describe("recentDefinitionRuns unhappy path", () => {
  it("returns nothing when there are no verdicts", () => {
    expect(recentDefinitionRuns([])).toEqual([]);
  });

  it("drops pending, running, aborted and timed out, and does not invent a time or a diagnosis", () => {
    expect(
      recentDefinitionRuns([
        source("pending", "pending", 5, { durationMs: 1, reason: "no" }),
        source("running", "running", 4, { summary: "still going" }),
        source("aborted", "aborted", 3, { reason: "aborted" }),
        source("timed", "timed_out", 2, { reason: "timed out" }),
        source("bare-pass", "passed", 1),
        source("bare-fail", "failed", 6, { reason: "" }),
      ]),
    ).toEqual([
      { id: "bare-fail", status: "failed", durationMs: null, diagnosis: null },
      { id: "bare-pass", status: "passed", durationMs: null, diagnosis: null },
    ]);
  });

  it("uses the result's reason when nobody diagnosed the failure, and the summary alone when the type is blank", () => {
    expect(
      recentDefinitionRuns([
        source("reason", "failed", 1, { reason: "driver gave up" }),
        source("blank-type", "failed", 2, { errorType: "", summary: "the screen stayed unlocked" }),
        source("blank", "failed", 3, { summary: "", reason: "" }),
      ]),
    ).toEqual([
      { id: "blank", status: "failed", durationMs: null, diagnosis: null },
      {
        id: "blank-type",
        status: "failed",
        durationMs: null,
        diagnosis: "the screen stayed unlocked",
      },
      { id: "reason", status: "failed", durationMs: null, diagnosis: "driver gave up" },
    ]);
  });

  it("breaks a tie on the result id so the newest ten stay stable", () => {
    expect(
      recentDefinitionRuns([
        source("b", "passed", 1, { durationMs: 1 }),
        source("a", "failed", 1, { reason: "no" }),
      ]).map((row) => row.id),
    ).toEqual(["a", "b"]);
  });
});

describe("resultDurationMs", () => {
  const start = new Date("2026-09-01T00:00:00Z");
  const four = new Date("2026-09-01T00:04:00Z");
  const two = new Date("2026-09-01T00:02:00Z");

  it("prefers the session's span, then the result's, and never a negative one", () => {
    expect(resultDurationMs(start, four, start, two)).toBe(2 * 60_000);
    expect(resultDurationMs(start, four, null, null)).toBe(4 * 60_000);
    expect(resultDurationMs(start, four, start, null)).toBe(4 * 60_000);
    expect(resultDurationMs(start, null, null, null)).toBeNull();
    expect(resultDurationMs(four, start, null, null)).toBeNull();
    expect(resultDurationMs(start, four, four, start)).toBeNull();
  });
});

describe("failureDiagnosis", () => {
  it("names the error type with the summary, and falls back when either is missing", () => {
    expect(failureDiagnosis("unlocked", "the screen stayed unlocked", "driver gave up")).toBe(
      "unlocked: the screen stayed unlocked",
    );
    expect(failureDiagnosis(null, "the screen stayed unlocked", "driver gave up")).toBe(
      "the screen stayed unlocked",
    );
    expect(failureDiagnosis(null, null, "driver gave up")).toBe("driver gave up");
    expect(failureDiagnosis(null, "", "")).toBeNull();
    expect(failureDiagnosis(null, null, null)).toBeNull();
  });
});

const runningJob = (test: string, ticket: string): AutomationJob => ({
  ticket,
  test,
  action: "drive",
  status: "running",
  reason: null,
  createdAt: new Date("2026-09-09T15:59:50Z"),
  startedAt: new Date("2026-09-09T15:59:50Z"),
  finishedAt: null,
  queriedAt: new Date("2026-09-09T16:00:00Z"),
});

describe("runningForDefinition", () => {
  it("keeps the jobs of that definition and drops the rest", () => {
    const jobs = [
      runningJob("lock-screen", "RUN-1"),
      runningJob("install", "OTHER"),
      runningJob("lock-screen", "RUN-2"),
    ];
    expect(runningForDefinition(jobs, "lock-screen").map((job) => job.ticket)).toEqual([
      "RUN-1",
      "RUN-2",
    ]);
    expect(runningForDefinition(jobs, "missing")).toEqual([]);
    expect(runningForDefinition([], "lock-screen")).toEqual([]);
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

  it("selects nothing from no groups", () => {
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

const QUERIED = at("2026-09-12T16:00:00Z");

const reading = (
  name: string,
  type: ProcessStat["type"],
  jobs: number,
  memoryBytes: number,
  cpuPercent: number,
  reportedAt: Date,
): ProcessStat => ({
  name,
  type,
  jobs,
  memoryBytes,
  cpuPercent,
  reportedAt,
  queriedAt: QUERIED,
});

describe("groupProcessSeries happy path", () => {
  it("groups readings of one name oldest first and takes the newest as the current reading", () => {
    const older = reading("garage", "qemu", 1, 256_000_000, 10, at("2026-09-12T15:59:00Z"));
    const newer = reading("garage", "qemu", 2, 512_000_000, 37.5, at("2026-09-12T15:59:30Z"));
    expect(groupProcessSeries([older, newer])).toEqual([
      {
        name: "garage",
        type: "qemu",
        jobs: 2,
        memoryBytes: 512_000_000,
        cpuPercent: 37.5,
        reportedAt: newer.reportedAt,
        queriedAt: QUERIED,
        samples: [
          { jobs: 1, memoryBytes: 256_000_000, cpuPercent: 10, reportedAt: older.reportedAt },
          { jobs: 2, memoryBytes: 512_000_000, cpuPercent: 37.5, reportedAt: newer.reportedAt },
        ],
      },
    ]);
  });

  it("keeps a series per type and name in the order the rows arrived, automation-client before qemu when listed that way", () => {
    const auto = reading("workshop", "automation-client", 1, 1, 4, at("2026-09-12T15:59:00Z"));
    const qemu = reading("garage", "qemu", 2, 2, 12, at("2026-09-12T15:59:00Z"));
    const qemuNext = reading("garage", "qemu", 3, 3, 20, at("2026-09-12T15:59:30Z"));
    const series = groupProcessSeries([auto, qemu, qemuNext]);
    expect(series.map((row) => `${row.type} ${row.name} ${String(row.jobs)}`)).toEqual([
      "automation-client workshop 1",
      "qemu garage 3",
    ]);
    expect(series[1]?.samples).toHaveLength(2);
  });
});

describe("groupProcessSeries unhappy path", () => {
  it("returns no series when there are no readings", () => {
    expect(groupProcessSeries([])).toEqual([]);
  });

  it("does not merge the same name across types", () => {
    const qemu = reading("garage", "qemu", 2, 1, 10, at("2026-09-12T15:59:00Z"));
    const auto = reading("garage", "automation-client", 1, 2, 4, at("2026-09-12T15:59:00Z"));
    const series = groupProcessSeries([qemu, auto]);
    expect(series).toHaveLength(2);
    expect(series.map((row) => row.type)).toEqual(["qemu", "automation-client"]);
    expect(series.every((row) => row.samples.length === 1)).toBe(true);
  });
});

const atMs = (ms: number): Date => new Date(ms);

const log = (text: string, ms: number): FollowLog => ({ text, at: atMs(ms) });

const action = (name: string, state: FollowAction["state"], ms: number): FollowAction => ({
  name,
  state,
  at: atMs(ms),
});

describe("actionName happy path", () => {
  it("reads the QMP command the action row stored", () => {
    expect(actionName({ execute: "screendump", arguments: {}, id: 1 })).toBe("screendump");
  });
});

describe("actionName unhappy path", () => {
  it("names nothing a command when execute is missing, empty, or not text", () => {
    expect(actionName(null)).toBe("?");
    expect(actionName("screendump")).toBe("?");
    expect(actionName({})).toBe("?");
    expect(actionName({ execute: "" })).toBe("?");
    expect(actionName({ execute: 1 })).toBe("?");
  });
});

describe("followEvents happy path", () => {
  it("orders intents and the commands under them by time, newest kept when the window fills", () => {
    const events = followEvents(
      [
        log("intent end", 3_000),
        log("intent start; open a terminal", 1_000),
        log("intent start; type hello", 4_000),
      ],
      [action("send-key", "completed", 2_000), action("screendump", "running", 5_000)],
    );
    expect(events).toEqual([
      { kind: "intent", text: "open a terminal", state: "completed", at: atMs(1_000) },
      { kind: "action", name: "send-key", state: "completed", under: true, at: atMs(2_000) },
      { kind: "intent", text: "type hello", state: "running", at: atMs(4_000) },
      { kind: "action", name: "screendump", state: "running", under: true, at: atMs(5_000) },
    ]);
  });

  it("keeps an action indented when its intent falls outside the newest window", () => {
    const logs: FollowLog[] = [log("intent start; open a terminal", 0)];
    const actions: FollowAction[] = Array.from({ length: FOLLOW_LIMIT }, (_, index) =>
      action("send-key", "completed", (index + 1) * 1_000),
    );
    const events = followEvents(logs, actions);
    expect(events).toHaveLength(FOLLOW_LIMIT);
    expect(events[0]).toEqual({
      kind: "action",
      name: "send-key",
      state: "completed",
      under: true,
      at: atMs(1_000),
    });
    expect(events.at(-1)).toMatchObject({ kind: "action", at: atMs(FOLLOW_LIMIT * 1_000) });
  });
});

describe("followEvents unhappy path", () => {
  it("ignores a log that is not an intent, an empty intent, and an end with nothing open", () => {
    expect(
      followEvents(
        [log("follower attached", 1_000), log("intent start; ", 2_000), log("intent end", 3_000)],
        [action("screendump", "failed", 4_000)],
      ),
    ).toEqual([
      { kind: "action", name: "screendump", state: "failed", under: false, at: atMs(4_000) },
    ]);
  });

  it("closes the previous intent when a second one starts without an end", () => {
    const events = followEvents(
      [log("intent start; first", 1_000), log("intent start; second", 3_000)],
      [action("send-key", "completed", 2_000)],
    );
    expect(events.map((event) => (event.kind === "intent" ? event.state : event.under))).toEqual([
      "completed",
      true,
      "running",
    ]);
  });
});

const suiteRow = (
  id: string,
  startedAt: number,
  counts: Partial<Pick<SuiteRow, "pending" | "running" | "passed" | "failed" | "stopped">> = {},
): SuiteRow => ({
  id,
  name: id,
  startedAt,
  pending: 0,
  running: 0,
  passed: 0,
  failed: 0,
  stopped: 0,
  ...counts,
});

describe("orderSuites happy path", () => {
  it("counts every suite and orders the pills finished, then running, then pending, each by createdAt", () => {
    const board = orderSuites([
      suiteRow("run-pending-new", 50, { pending: 2, passed: 1 }),
      suiteRow("run-failed", 20, { failed: 1, passed: 3 }),
      suiteRow("run-running-old", 5, { running: 1, pending: 4 }),
      suiteRow("run-passed", 10, { passed: 2 }),
      suiteRow("run-pending-old", 4, { pending: 1 }),
      suiteRow("run-running-new", 40, { running: 2 }),
    ]);
    expect(board.pending).toBe(2);
    expect(board.running).toBe(2);
    expect(board.passed).toBe(1);
    expect(board.failed).toBe(1);
    expect(board.aborted).toBe(0);
    expect(board.pills.map((pill) => pill.id)).toEqual([
      "run-passed",
      "run-failed",
      "run-running-old",
      "run-running-new",
      "run-pending-old",
      "run-pending-new",
    ]);
    expect(board.pills.map((pill) => pill.status)).toEqual([
      "passed",
      "failed",
      "running",
      "running",
      "pending",
      "pending",
    ]);
  });

  it("keeps the latest fifty finished suites and the oldest fifty that are still open", () => {
    const finished = Array.from({ length: 51 }, (_, index) =>
      suiteRow(`fin-${String(index).padStart(2, "0")}`, index, { passed: 1 }),
    );
    const running = Array.from({ length: 51 }, (_, index) =>
      suiteRow(`run-${String(index).padStart(2, "0")}`, 1_000 + index, { running: 1 }),
    );
    const pending = Array.from({ length: 51 }, (_, index) =>
      suiteRow(`pen-${String(index).padStart(2, "0")}`, 2_000 + index, { pending: 1 }),
    );
    const board = orderSuites([...pending, ...running, ...finished]);
    expect(board.passed).toBe(51);
    expect(board.running).toBe(51);
    expect(board.pending).toBe(51);
    const ids = board.pills.map((pill) => pill.id);
    expect(ids).toHaveLength(150);
    expect(ids.slice(0, 50)).toEqual(
      Array.from({ length: 50 }, (_, index) => `fin-${String(index + 1).padStart(2, "0")}`),
    );
    expect(ids.slice(50, 100)).toEqual(
      Array.from({ length: 50 }, (_, index) => `run-${String(index).padStart(2, "0")}`),
    );
    expect(ids.slice(100)).toEqual(
      Array.from({ length: 50 }, (_, index) => `pen-${String(index).padStart(2, "0")}`),
    );
    expect(ids).not.toContain("fin-00");
    expect(ids).not.toContain("run-50");
    expect(ids).not.toContain("pen-50");
  });

  it("orders two suites created together by id", () => {
    const board = orderSuites([suiteRow("b", 1, { passed: 1 }), suiteRow("a", 1, { failed: 1 })]);
    expect(board.pills.map((pill) => pill.id)).toEqual(["a", "b"]);
  });
});

describe("orderSuites unhappy path", () => {
  it("is empty when nothing has run", () => {
    expect(orderSuites([])).toEqual({
      pending: 0,
      running: 0,
      passed: 0,
      failed: 0,
      aborted: 0,
      pills: [],
    });
  });

  it("calls a suite aborted when every result was aborted or timed out, and does not count it failed", () => {
    const board = orderSuites([suiteRow("stopped", 3, { stopped: 2 })]);
    expect(board.aborted).toBe(1);
    expect(board.failed).toBe(0);
    expect(board.passed).toBe(0);
    expect(board.pills.map((pill) => pill.status)).toEqual(["aborted"]);
  });

  it("does not call a suite succeeded when a pass shares the run with an abort", () => {
    const board = orderSuites([suiteRow("mixed", 6, { passed: 1, stopped: 2 })]);
    expect(board.aborted).toBe(1);
    expect(board.passed).toBe(0);
    expect(board.pills[0]?.status).toBe("aborted");
  });

  it("stays pending while a result is still pending, even after another result failed", () => {
    const board = orderSuites([suiteRow("open", 8, { pending: 1, failed: 2, passed: 1 })]);
    expect(board.pending).toBe(1);
    expect(board.failed).toBe(0);
    expect(board.pills[0]?.status).toBe("pending");
  });

  it("is failed once it has closed with a failure, even when other results passed", () => {
    const board = orderSuites([suiteRow("done", 8, { failed: 1, passed: 4 })]);
    expect(board.failed).toBe(1);
    expect(board.passed).toBe(0);
    expect(board.pills[0]?.status).toBe("failed");
  });
});
