import type * as Stores from "@oligarchy/stores";
import * as jarl from "jarl";
import { describe, expect, it } from "vitest";
import { diagnosable } from "../src/find.ts";
import type { Needs } from "../src/needs.ts";
import { errorOf, only, refusedWrite, resultRow } from "./support.ts";

const JOB = resultRow();

type Statuses = Partial<Record<Stores.Automation.AutomationAction, Stores.Automation.JobStatus>>;

// An automation store whose job has the actions in `statuses`, and no others.
const actions = (statuses: Statuses) => ({
  automation: only<Needs["automation"]>({
    jobStatus: async (resultId, action) =>
      jarl.ok(resultId === JOB.id ? statuses[action] : undefined),
  }),
});

describe("whether a job can be diagnosed", () => {
  it("a completed drive, or a completed mint with no drive, is ready (happy)", async () => {
    expect(await diagnosable(actions({ drive: "completed" }), JOB)).toEqual(
      jarl.ok({ kind: "ready" }),
    );
    expect(await diagnosable(actions({ mint: "completed" }), JOB)).toEqual(
      jarl.ok({ kind: "ready" }),
    );
  });

  it("a pending or running drive holds the diagnose (error)", async () => {
    expect(await diagnosable(actions({ drive: "pending" }), JOB)).toEqual(
      jarl.ok({ kind: "held" }),
    );
    expect(await diagnosable(actions({ drive: "running", mint: "completed" }), JOB)).toEqual(
      jarl.ok({ kind: "held" }),
    );
  });

  it("a drive that ended otherwise, or none at all, strands the diagnose, saying all it can (error)", async () => {
    const judged = resultRow({ status: "failed", reason: "wifi never joined", sessionId: "s-1" });
    const stranded = async (statuses: Statuses, job = JOB) => {
      const store = only<Needs["automation"]>({
        jobStatus: async (_resultId, action) => jarl.ok(statuses[action]),
      });
      return diagnosable({ automation: store }, job);
    };

    expect(await stranded({ drive: "errored", mint: "completed" }, judged)).toEqual(
      jarl.ok({
        kind: "stranded",
        reason:
          "stranded; drive errored; result result-1 is failed: wifi never joined; session s-1",
      }),
    );
    expect(await stranded({ mint: "aborted" })).toEqual(
      jarl.ok({
        kind: "stranded",
        reason: "stranded; mint aborted; result result-1 is passed; session none",
      }),
    );
    expect(await stranded({})).toEqual(
      jarl.ok({
        kind: "stranded",
        reason: "stranded; no drive or mint; result result-1 is passed; session none",
      }),
    );
  });

  it("is the failure of the drive's or the mint's status read that fails (error)", async () => {
    const failure = refusedWrite("connection reset");
    const drive = only<Needs["automation"]>({ jobStatus: async () => jarl.err(failure) });
    const mint = only<Needs["automation"]>({
      jobStatus: async (_resultId, action) =>
        action === "mint" ? jarl.err(failure) : jarl.ok(undefined),
    });

    expect(errorOf(await diagnosable({ automation: drive }, JOB))).toBe(failure);
    expect(errorOf(await diagnosable({ automation: mint }, JOB))).toBe(failure);
  });
});
