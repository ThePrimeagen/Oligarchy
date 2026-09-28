import * as Linear from "@oligarchy/linear";
import * as jarl from "jarl";
import { describe, expect, it } from "vitest";
import { actionFor, already, asks, enqueue } from "../src/board.ts";
import type { Needs } from "../src/needs.ts";
import {
  database,
  duplicateKey,
  errorOf,
  only,
  refusedWrite,
  resultRow,
  storedJob,
} from "./support.ts";

const JOB = resultRow({ definitionId: 7 });

// A tests store whose one definition, id 7, is named `name`.
const named = (name: string | undefined) =>
  only<Needs["tests"]>({
    definitionName: async (id) => jarl.ok(id === JOB.definitionId ? name : "someone else's"),
  });

describe("what a column asks of a job", () => {
  it("Automation Needed and Needs Review ask; any other column asks nothing (happy)", () => {
    expect(asks(Linear.AUTOMATION_NEEDED_STATE)).toBe(true);
    expect(asks(Linear.NEEDS_REVIEW_STATE)).toBe(true);
    expect(asks(Linear.IN_PROGRESS_STATE)).toBe(false);
    expect(asks(Linear.BACKLOG_STATE)).toBe(false);
    expect(asks("automation needed")).toBe(false);
  });

  it("Automation Needed is a drive, or a mint for the mint definition; Needs Review a diagnose (happy)", async () => {
    expect(await actionFor({ tests: named("wifi") }, Linear.AUTOMATION_NEEDED_STATE, JOB)).toEqual(
      jarl.ok("drive"),
    );
    expect(await actionFor({ tests: named("mint") }, Linear.AUTOMATION_NEEDED_STATE, JOB)).toEqual(
      jarl.ok("mint"),
    );
    expect(await actionFor({ tests: only({}) }, Linear.NEEDS_REVIEW_STATE, JOB)).toEqual(
      jarl.ok("diagnose"),
    );
  });

  it("Automation Needed is a drive for a job whose definition is gone (error)", async () => {
    const action = await actionFor(
      { tests: named(undefined) },
      Linear.AUTOMATION_NEEDED_STATE,
      JOB,
    );

    expect(action).toEqual(jarl.ok("drive"));
  });

  it("is the failure of a definition lookup that fails (error)", async () => {
    const failure = refusedWrite("connection reset");
    const tests = only<Needs["tests"]>({ definitionName: async () => jarl.err(failure) });

    const action = await actionFor({ tests }, Linear.AUTOMATION_NEEDED_STATE, JOB);

    expect(errorOf(action)).toBe(failure);
  });
});

describe("queueing an action", () => {
  it("inserts the pending action and answers queued (happy)", async () => {
    const stores = await database();
    const job = await storedJob(stores, "wifi");

    const queued = await enqueue(stores, job, "drive");

    expect(queued).toEqual(jarl.ok({ result: "queued", action: "drive" }));
    expect(await stores.automation.jobStatus(job.id, "drive")).toEqual(jarl.ok("pending"));
  });

  it("a second time is a duplicate, named by the status of the row it hit (error)", async () => {
    const stores = await database();
    const job = await storedJob(stores, "wifi");
    const row = jarl.unwrap(await stores.automation.enqueue({ resultId: job.id, action: "drive" }));

    const waiting = jarl.unwrap(await enqueue(stores, job, "drive"));
    jarl.unwrap(await stores.automation.finish(row.id, "completed", null));
    const ended = jarl.unwrap(await enqueue(stores, job, "drive"));

    expect(waiting).toEqual({ result: "duplicate", action: "drive", status: "pending" });
    expect(waiting.result === "duplicate" && already(waiting)).toBe("drive already queued");
    expect(ended).toEqual({ result: "duplicate", action: "drive", status: "completed" });
    expect(ended.result === "duplicate" && already(ended)).toBe("drive already completed");
  });

  it("a duplicate whose row was swept before its status was read reads as queued (error)", async () => {
    const automation = only<Needs["automation"]>({
      enqueue: async () => jarl.err(duplicateKey()),
      jobStatus: async () => jarl.ok(undefined),
    });

    const queued = await enqueue({ automation }, JOB, "diagnose");

    expect(queued).toEqual(jarl.ok({ result: "duplicate", action: "diagnose", status: "pending" }));
  });

  it("is the failure of an insert that fails but for a duplicate (error)", async () => {
    const failure = refusedWrite("connection reset");
    const automation = only<Needs["automation"]>({ enqueue: async () => jarl.err(failure) });

    const queued = await enqueue({ automation }, JOB, "drive");

    expect(errorOf(queued)).toBe(failure);
  });

  it("is the failure of the status read after a duplicate (error)", async () => {
    const failure = refusedWrite("connection reset");
    const automation = only<Needs["automation"]>({
      enqueue: async () => jarl.err(duplicateKey()),
      jobStatus: async () => jarl.err(failure),
    });

    const queued = await enqueue({ automation }, JOB, "drive");

    expect(errorOf(queued)).toBe(failure);
  });
});
