import * as Linear from "@oligarchy/linear";
import * as jarl from "jarl";
import { describe, expect, it } from "vitest";
import { actionFor, already, asks, enqueue, queue } from "../src/board.ts";
import type { Needs } from "../src/needs.ts";
import {
  actionRow,
  database,
  duplicateKey,
  errorOf,
  fakeLinear,
  logging,
  only,
  refused,
  refusedWrite,
  resultRow,
  type Script,
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

// Every need queueing has, faked: OLI-42 is JOB's ticket, a wifi test, whose action queues,
// unless a test says otherwise. `calls` keeps every store write asked.
const queueing = (
  given: {
    readonly tests?: Partial<Needs["tests"]>;
    readonly automation?: Partial<Needs["automation"]>;
    readonly linear?: Script;
  } = {},
) => {
  const { linear, asked } = fakeLinear(given.linear);
  const { lines, logger } = logging();
  const calls: Array<string> = [];
  const needs = {
    tests: only<Needs["tests"]>({
      findResultByLinearId: async (ticket) => jarl.ok(ticket === "OLI-42" ? JOB : undefined),
      definitionName: async () => jarl.ok("wifi"),
      errorResult: async (id, reason) => {
        calls.push(`errorResult ${id} ${reason}`);
        return jarl.ok(true);
      },
      ...given.tests,
    }),
    automation: only<Needs["automation"]>({
      enqueue: async (input) => {
        calls.push(`enqueue ${input.resultId} ${input.action}`);
        return jarl.ok(actionRow({ resultId: input.resultId, action: input.action }));
      },
      ...given.automation,
    }),
    linear,
    logger,
  };
  return { needs, asked, lines, calls };
};

describe("a ticket moving into a column that asks an action", () => {
  it("Automation Needed readies the ticket in Linear, then queues its drive (happy)", async () => {
    const stores = await database();
    const { linear, asked } = fakeLinear();
    const { lines, logger } = logging();
    const job = await storedJob(stores, "wifi");

    const queued = await queue(
      { ...stores, linear, logger },
      "OLI-42",
      Linear.AUTOMATION_NEEDED_STATE,
    );

    expect(queued).toEqual({ result: "queued", action: "drive" });
    expect(asked).toEqual(["readyForAutomation OLI-42"]);
    expect(await stores.automation.jobStatus(job.id, "drive")).toEqual(jarl.ok("pending"));
    expect(lines).toEqual([]);
  });

  it("Needs Review queues a diagnose and asks nothing of Linear", async () => {
    const { needs, asked, calls } = queueing();

    expect(await queue(needs, "OLI-42", Linear.NEEDS_REVIEW_STATE)).toEqual({
      result: "queued",
      action: "diagnose",
    });
    expect(asked).toEqual([]);
    expect(calls).toEqual(["enqueue result-1 diagnose"]);
  });

  it("touches nothing for a ticket no job carries: it is not ours (error)", async () => {
    const { needs, asked, calls, lines } = queueing();

    expect(await queue(needs, "OLI-99", Linear.AUTOMATION_NEEDED_STATE)).toEqual({
      result: "unknown",
    });
    expect([...asked, ...calls, ...lines]).toEqual([]);
  });

  it("an action already queued is the duplicate, and the ticket stays where it is (error)", async () => {
    const { needs, asked } = queueing({
      automation: {
        enqueue: async () => jarl.err(duplicateKey()),
        jobStatus: async () => jarl.ok("pending"),
      },
    });

    expect(await queue(needs, "OLI-42", Linear.AUTOMATION_NEEDED_STATE)).toEqual({
      result: "duplicate",
      action: "drive",
      status: "pending",
    });
    expect(asked).toEqual(["readyForAutomation OLI-42"]);
  });

  const failure = refusedWrite("connection reset");
  const notReady = refused("linear: moving OLI-42 to Automation Needed failed");

  it.each([
    [
      "Linear will not ready it",
      { linear: { readyForAutomation: [jarl.err(notReady)] } },
      `readying it failed; ${notReady.message}`,
    ],
    [
      "its action cannot be chosen",
      { tests: { definitionName: async () => jarl.err(failure) } },
      "choosing its action failed; connection reset",
    ],
    [
      "its action will not queue",
      { automation: { enqueue: async () => jarl.err(failure) } },
      "queueing its drive failed; connection reset",
    ],
  ] as const)(
    "errors the drive's result and moves the ticket to Errored when %s, queueing nothing (error)",
    async (_, given, why) => {
      const { needs, asked, calls, lines } = queueing(given);
      const reason = `queue errored; ${why}`;

      expect(await queue(needs, "OLI-42", Linear.AUTOMATION_NEEDED_STATE)).toEqual({
        result: "errored",
        reason,
      });
      expect(calls).toEqual([`errorResult result-1 ${reason}`]);
      expect(asked).toEqual(["readyForAutomation OLI-42", `markErrored OLI-42: ${reason}`]);
      expect(lines).toEqual([`[ERROR] [OLI-42] automation: ${reason}`]);
    },
  );

  it("moves the ticket to Errored when its job cannot be looked up, touching no result (error)", async () => {
    const { needs, asked, calls } = queueing({
      tests: { findResultByLinearId: async () => jarl.err(failure) },
    });
    const reason = "queue errored; finding its job failed; connection reset";

    expect(await queue(needs, "OLI-42", Linear.AUTOMATION_NEEDED_STATE)).toEqual({
      result: "errored",
      reason,
    });
    expect(calls).toEqual([]);
    expect(asked).toEqual([`markErrored OLI-42: ${reason}`]);
  });

  it("leaves the result a diagnose would judge alone when it will not queue (error)", async () => {
    const { needs, asked, calls } = queueing({
      automation: { enqueue: async () => jarl.err(failure) },
    });
    const reason = "queue errored; queueing its diagnose failed; connection reset";

    expect(await queue(needs, "OLI-42", Linear.NEEDS_REVIEW_STATE)).toEqual({
      result: "errored",
      reason,
    });
    expect(calls).toEqual([]);
    expect(asked).toEqual([`markErrored OLI-42: ${reason}`]);
  });

  it("says so in the same line when the move to Errored, or the result's write, fails too (error)", async () => {
    const moveFails = queueing({
      automation: { enqueue: async () => jarl.err(failure) },
      linear: { markErrored: [jarl.err(refused("linear: moving OLI-42 to Errored failed"))] },
    });
    const writeFails = queueing({
      automation: { enqueue: async () => jarl.err(failure) },
      tests: { errorResult: async () => jarl.err(failure) },
    });
    const reason = "queue errored; queueing its drive failed; connection reset";

    await queue(moveFails.needs, "OLI-42", Linear.AUTOMATION_NEEDED_STATE);
    await queue(writeFails.needs, "OLI-42", Linear.AUTOMATION_NEEDED_STATE);

    expect(moveFails.lines).toEqual([
      `[ERROR] [OLI-42] automation: ${reason}; move to Errored failed: linear: moving OLI-42 to Errored failed`,
    ]);
    expect(writeFails.lines).toEqual([
      `[ERROR] [OLI-42] automation: ${reason}; result errored write failed: connection reset`,
    ]);
  });
});
