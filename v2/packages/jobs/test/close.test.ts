import { randomUUID } from "node:crypto";
import type * as Stores from "@oligarchy/stores";
import * as jarl from "jarl";
import { describe, expect, it } from "vitest";
import { close, judge, type Outcome } from "../src/close.ts";
import type { Job, Needs } from "../src/needs.ts";
import {
  actionRow,
  database,
  errorOf,
  fakeLinear,
  ISO,
  logging,
  only,
  refused,
  refusedWrite,
  resultRow,
  type Script,
  storedJob,
} from "./support.ts";

const SESSION = "5e55a000-0000-4000-8000-000000000001";

const session = (row: Partial<Stores.Sessions.SessionRow> = {}): Stores.Sessions.SessionRow => ({
  id: SESSION,
  config: { iso: ISO },
  status: "succeeded",
  reason: null,
  startedAt: new Date(0),
  endedAt: new Date(0),
  ...row,
});

const verdictRow = (verdict: Stores.Diagnosis.Verdict): Stores.Diagnosis.DiagnosisRow => ({
  sessionId: SESSION,
  verdict,
  errorType: verdict === "passed" ? null : "wrong-screen",
  summary: "looked at it",
  model: "grok",
  createdAt: new Date(0),
});

const DRIVE = actionRow({ action: "drive" });
const DIAGNOSE = actionRow({ id: "action-2", action: "diagnose" });
const JOB = resultRow({ sessionId: SESSION, status: "passed" });

const COMPLETED: Outcome = { status: "completed", reason: null };
const SUCCEEDED: Outcome = { status: "succeeded", reason: null };

const reset = () => refusedWrite("connection reset");

// What judge reads: the job and its session.
const judging = (job: Job | undefined, found: Stores.Sessions.SessionRow | undefined) => ({
  tests: only<Needs["tests"]>({ findResult: async () => jarl.ok(job) }),
  sessions: only<Needs["sessions"]>({ getSession: async () => jarl.ok(found) }),
});

describe("judging an action whose driver exited cleanly", () => {
  it("a drive its driver closed is completed; a diagnose is succeeded, nothing read (happy)", async () => {
    expect(await judge(judging(JOB, session()), DRIVE)).toEqual(jarl.ok(COMPLETED));
    expect(await judge(judging(resultRow({ status: "failed" }), undefined), DRIVE)).toEqual(
      jarl.ok(COMPLETED),
    );
    expect(await judge({ tests: only({}), sessions: only({}) }, DIAGNOSE)).toEqual(
      jarl.ok(SUCCEEDED),
    );
  });

  it("is errored, naming the status, for a job its driver left open (error)", async () => {
    const judged = await judge(judging(resultRow({ status: "running" }), undefined), DRIVE);

    expect(judged).toEqual(
      jarl.ok({ status: "errored", reason: "driver exited; result result-1 is running" }),
    );
  });

  it("is errored for a session the qemu server errored, with its reason when it has one (error)", async () => {
    const lost = session({ status: "errored", reason: "qemu exited 1" });

    expect(await judge(judging(JOB, lost), DRIVE)).toEqual(
      jarl.ok({ status: "errored", reason: `session ${SESSION} errored; qemu exited 1` }),
    );
    expect(await judge(judging(JOB, session({ status: "errored" })), DRIVE)).toEqual(
      jarl.ok({ status: "errored", reason: `session ${SESSION} errored` }),
    );
  });

  it("throws for a result that vanished during the drive (error)", async () => {
    await expect(judge(judging(undefined, undefined), DRIVE)).rejects.toThrow(
      "judge: result result-1 vanished during the drive",
    );
  });

  it("is the failure of a result or session read that fails (error)", async () => {
    const failure = reset();
    const result = {
      ...judging(JOB, undefined),
      tests: only<Needs["tests"]>({ findResult: async () => jarl.err(failure) }),
    };
    const read = {
      ...judging(JOB, undefined),
      sessions: only<Needs["sessions"]>({ getSession: async () => jarl.err(failure) }),
    };

    expect(errorOf(await judge(result, DRIVE))).toBe(failure);
    expect(errorOf(await judge(read, DRIVE))).toBe(failure);
  });
});

// Every need close has, faked: the row closes, the job is JOB, its verdict passed, unless a test
// says otherwise. `calls` keeps every store write asked.
const closing = (
  given: {
    readonly automation?: Partial<Needs["automation"]>;
    readonly tests?: Partial<Needs["tests"]>;
    readonly diagnosis?: Partial<Needs["diagnosis"]>;
    readonly linear?: Script;
  } = {},
) => {
  const { linear, asked } = fakeLinear(given.linear);
  const { lines, logger } = logging();
  const calls: Array<string> = [];
  const needs = {
    automation: only<Needs["automation"]>({
      finish: async (id, status, reason) => {
        calls.push(`finish ${id} ${status} ${String(reason)}`);
        return jarl.ok(true);
      },
      ...given.automation,
    }),
    tests: only<Needs["tests"]>({
      findResult: async () => jarl.ok(JOB),
      errorResult: async (id, reason) => {
        calls.push(`errorResult ${id} ${reason}`);
        return jarl.ok(true);
      },
      ...given.tests,
    }),
    diagnosis: only<Needs["diagnosis"]>({
      getDiagnosis: async () => {
        calls.push("getDiagnosis");
        return jarl.ok(verdictRow("passed"));
      },
      ...given.diagnosis,
    }),
    linear,
    logger,
  };
  return { needs, asked, lines, calls };
};

// A write the database refuses `times` times, then answers `then`.
const failing = (times: number, then: boolean) => {
  let made = 0;
  return async () => {
    made += 1;
    return made <= times ? jarl.err(reset()) : jarl.ok(then);
  };
};

describe("closing an action", () => {
  it("a completed drive clears ready and goes to Needs Review; its passed diagnose to Succeeded (happy)", async () => {
    const stores = await database();
    const { linear, asked } = fakeLinear();
    const { lines, logger } = logging();
    const needs = { ...stores, linear, logger };
    const job = await storedJob(stores, "wifi");
    const sessionId = randomUUID();
    jarl.unwrap(await stores.sessions.insertSession(sessionId, { iso: ISO }, "running"));
    jarl.unwrap(await stores.tests.closeResult(job.id, "passed", null, sessionId));
    const drive = jarl.unwrap(
      await stores.automation.enqueue({ resultId: job.id, action: "drive" }),
    );

    const drove = await close(needs, drive, COMPLETED);

    expect(drove).toEqual(jarl.ok(true));
    expect(asked).toEqual(["clearReady OLI-42", "moveToNeedsReview OLI-42"]);
    expect(await stores.automation.jobStatus(job.id, "drive")).toEqual(jarl.ok("completed"));

    jarl.unwrap(
      await stores.diagnosis.saveDiagnosis({
        sessionId,
        verdict: "passed",
        errorType: null,
        summary: "the network joined",
        model: "grok",
      }),
    );
    const diagnose = jarl.unwrap(
      await stores.automation.enqueue({ resultId: job.id, action: "diagnose" }),
    );
    const diagnosed = await close(needs, diagnose, SUCCEEDED);

    expect(diagnosed).toEqual(jarl.ok(true));
    expect(asked.slice(2)).toEqual(["moveToSucceeded OLI-42"]);
    expect(await stores.automation.jobStatus(job.id, "diagnose")).toEqual(jarl.ok("succeeded"));
    expect(lines).toEqual([
      "[INFO] [global] automation: drive completed",
      "[INFO] [global] automation: diagnose succeeded",
    ]);
  });

  it("moves a diagnose whose verdict is failed to Failed (error)", async () => {
    const { needs, asked } = closing({
      diagnosis: { getDiagnosis: async () => jarl.ok(verdictRow("failed")) },
    });

    expect(await close(needs, DIAGNOSE, SUCCEEDED)).toEqual(jarl.ok(true));
    expect(asked).toEqual(["moveToFailed OLI-42"]);
  });

  it("says a diagnose with no session, or no verdict row, has no verdict, and moves nothing (error)", async () => {
    const unseen = closing({ tests: { findResult: async () => jarl.ok(resultRow()) } });
    const unwritten = closing({ diagnosis: { getDiagnosis: async () => jarl.ok(undefined) } });

    expect(await close(unseen.needs, DIAGNOSE, SUCCEEDED)).toEqual(jarl.ok(true));
    expect(await close(unwritten.needs, DIAGNOSE, SUCCEEDED)).toEqual(jarl.ok(true));

    expect(unseen.asked).toEqual([]);
    expect(unseen.lines.slice(1)).toEqual([
      "[ERROR] [OLI-42] automation: diagnose verdict missing; result-1",
    ]);
    expect(unwritten.asked).toEqual([]);
    expect(unwritten.lines.slice(1)).toEqual([
      `[ERROR] [OLI-42] automation: diagnose verdict missing; ${SESSION}`,
    ]);
  });

  it("says a verdict read failing three times failed, and moves nothing (error)", async () => {
    let reads = 0;
    const { needs, asked, lines } = closing({
      diagnosis: {
        getDiagnosis: async () => {
          reads += 1;
          return jarl.err(reset());
        },
      },
    });

    expect(await close(needs, DIAGNOSE, SUCCEEDED)).toEqual(jarl.ok(true));
    expect(reads).toBe(3);
    expect(asked).toEqual([]);
    expect(lines.slice(1)).toEqual([
      `[ERROR] [OLI-42] automation: diagnose verdict read failed; ${SESSION}: connection reset`,
    ]);
  });

  it("is false, one line naming the status it should have, and nothing moved, for a row write failing three times (error)", async () => {
    let writes = 0;
    const { needs, asked, lines } = closing({
      automation: {
        finish: async () => {
          writes += 1;
          return jarl.err(reset());
        },
      },
    });

    expect(await close(needs, DRIVE, COMPLETED)).toEqual(jarl.ok(false));
    expect(writes).toBe(3);
    expect(asked).toEqual([]);
    expect(lines).toEqual([
      "[ERROR] [global] automation: close write failed; action-1 should be completed: connection reset",
    ]);
  });

  it("lands a row write failing twice on the third attempt (error)", async () => {
    const { needs, asked, lines } = closing({
      automation: { finish: failing(2, true) },
    });

    expect(await close(needs, DRIVE, COMPLETED)).toEqual(jarl.ok(true));
    expect(asked).toEqual(["clearReady OLI-42", "moveToNeedsReview OLI-42"]);
    expect(lines).toEqual(["[INFO] [global] automation: drive completed"]);
  });

  it("is false and moves nothing for a row something else closed first (error)", async () => {
    const { needs, asked, lines } = closing({
      automation: { finish: async () => jarl.ok(false) },
    });

    expect(await close(needs, DRIVE, COMPLETED)).toEqual(jarl.ok(false));
    expect(asked).toEqual([]);
    expect(lines).toEqual([]);
  });

  it("errors an errored drive's result, clears ready, and moves it to Errored with the reason (error)", async () => {
    const { needs, asked, lines, calls } = closing();
    const reason = "driver exited; result result-1 is running";

    expect(await close(needs, DRIVE, { status: "errored", reason })).toEqual(jarl.ok(true));
    expect(calls).toEqual([`finish action-1 errored ${reason}`, `errorResult result-1 ${reason}`]);
    expect(asked).toEqual(["clearReady OLI-42", `moveToErrored OLI-42: drive errored; ${reason}`]);
    expect(lines).toEqual([`[ERROR] [global] automation: drive errored; ${reason}`]);
  });

  it("leaves the result an errored diagnose was judging alone, and moves it to Errored (error)", async () => {
    const { needs, asked, calls } = closing();

    const closed = await close(needs, DIAGNOSE, { status: "errored", reason: "agent quit" });

    expect(closed).toEqual(jarl.ok(true));
    expect(calls).toEqual(["finish action-2 errored agent quit"]);
    expect(asked).toEqual(["moveToErrored OLI-42: diagnose errored; agent quit"]);
  });

  it("still moves the ticket to Errored when the result's errored write fails three times, in one line (error)", async () => {
    let writes = 0;
    const { needs, asked, lines } = closing({
      tests: {
        errorResult: async () => {
          writes += 1;
          return jarl.err(reset());
        },
      },
    });

    expect(await close(needs, DRIVE, { status: "errored", reason: "lost" })).toEqual(jarl.ok(true));
    expect(writes).toBe(3);
    expect(asked).toEqual(["clearReady OLI-42", "moveToErrored OLI-42: drive errored; lost"]);
    expect(lines).toEqual([
      "[ERROR] [global] automation: drive errored; lost",
      "[ERROR] [OLI-42] automation: result errored write failed; result-1: connection reset",
    ]);
  });

  it("keeps the row closed when the move fails three times, in one line (error)", async () => {
    const no = jarl.err(refused("linear: moving OLI-42 to Needs Review failed"));
    const { needs, asked, lines } = closing({ linear: { moveToNeedsReview: [no, no, no] } });

    expect(await close(needs, DRIVE, COMPLETED)).toEqual(jarl.ok(true));
    expect(asked.filter((call) => call === "moveToNeedsReview OLI-42")).toHaveLength(3);
    expect(lines).toEqual([
      "[INFO] [global] automation: drive completed",
      "[ERROR] [OLI-42] automation: move to Needs Review failed: linear: moving OLI-42 to Needs Review failed",
    ]);
  });

  it("clears an aborted drive's ready label and leaves its ticket where it is (error)", async () => {
    const { needs, asked, lines } = closing();

    const closed = await close(needs, DRIVE, { status: "aborted", reason: "aborted" });

    expect(closed).toEqual(jarl.ok(true));
    expect(asked).toEqual(["clearReady OLI-42"]);
    expect(lines).toEqual(["[INFO] [global] automation: drive aborted"]);
  });

  it("closes the row of an action without a ticket, or whose job was swept, and moves nothing (error)", async () => {
    const unticketed = closing({
      tests: { findResult: async () => jarl.ok(resultRow({ linearId: null })) },
    });
    const swept = closing({ tests: { findResult: async () => jarl.ok(undefined) } });

    expect(await close(unticketed.needs, DRIVE, COMPLETED)).toEqual(jarl.ok(true));
    expect(await close(swept.needs, DIAGNOSE, SUCCEEDED)).toEqual(jarl.ok(true));
    expect(unticketed.asked).toEqual([]);
    expect(swept.asked).toEqual([]);
    expect(unticketed.calls).toEqual(["finish action-1 completed null"]);
    expect(swept.calls).toEqual(["finish action-2 succeeded null"]);
  });

  it("is the failure of the job lookup after the row closed (error)", async () => {
    const failure = reset();
    const { needs, asked, calls } = closing({
      tests: { findResult: async () => jarl.err(failure) },
    });

    expect(errorOf(await close(needs, DRIVE, COMPLETED))).toBe(failure);
    expect(calls).toEqual(["finish action-1 completed null"]);
    expect(asked).toEqual([]);
  });
});
