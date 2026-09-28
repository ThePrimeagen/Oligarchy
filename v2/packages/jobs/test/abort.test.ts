import * as jarl from "jarl";
import { describe, expect, it } from "vitest";
import { abort, running } from "../src/abort.ts";
import { NoPendingAction } from "../src/errors.ts";
import type { Needs } from "../src/needs.ts";
import {
  actionRow,
  database,
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

// Every need abort has, faked: OLI-42 is result-1's ticket and its pending action closes, unless
// a test says otherwise.
const aborting = (
  given: {
    readonly tests?: Partial<Needs["tests"]>;
    readonly automation?: Partial<Needs["automation"]>;
    readonly linear?: Script;
  } = {},
) => {
  const { linear, asked } = fakeLinear(given.linear);
  const { lines, logger } = logging();
  const finished: Array<string> = [];
  const needs = {
    tests: only<Needs["tests"]>({
      findResultByLinearId: async (ticket) =>
        jarl.ok(ticket === "OLI-42" ? resultRow() : undefined),
      ...given.tests,
    }),
    automation: only<Needs["automation"]>({
      abortPending: async () => jarl.ok(true),
      finish: async (id, status, reason) => {
        finished.push(`${id} ${status} ${String(reason)}`);
        return jarl.ok(true);
      },
      ...given.automation,
    }),
    linear,
    logger,
  };
  return { needs, asked, lines, finished };
};

const expectNoPending = (error: unknown, message: string) => {
  expect(jarl.error.is(error, NoPendingAction)).toBe(true);
  expect(error).toHaveProperty("message", message);
};

describe("aborting a pending action", () => {
  it("closes its row aborted, says so, and moves the ticket to Aborted (happy)", async () => {
    const stores = await database();
    const { linear, asked } = fakeLinear();
    const { lines, logger } = logging();
    const job = await storedJob(stores, "wifi");
    jarl.unwrap(await stores.automation.enqueue({ resultId: job.id, action: "drive" }));

    const aborted = await abort({ ...stores, linear, logger }, "OLI-42", "drive");

    expect(aborted).toEqual(jarl.ok(undefined));
    expect(await stores.automation.jobStatus(job.id, "drive")).toEqual(jarl.ok("aborted"));
    expect(lines).toEqual(["[INFO] [OLI-42] automation: aborted pending drive"]);
    expect(asked).toEqual(["markAborted OLI-42"]);
  });

  it("is NoPendingAction for a ticket with no job, or no pending action, and moves nothing (error)", async () => {
    const unknown = aborting();
    const taken = aborting({ automation: { abortPending: async () => jarl.ok(false) } });

    expectNoPending(
      errorOf(await abort(unknown.needs, "OLI-99", "drive")),
      'ticket "OLI-99" has no drive to abort',
    );
    expectNoPending(
      errorOf(await abort(taken.needs, "OLI-42", "diagnose")),
      'ticket "OLI-42" has no diagnose to abort',
    );
    expect([...unknown.asked, ...taken.asked, ...unknown.lines, ...taken.lines]).toEqual([]);
  });

  it("is the failure of a job lookup or row write that fails, and moves nothing (error)", async () => {
    const failure = refusedWrite("connection reset");
    const lookup = aborting({ tests: { findResultByLinearId: async () => jarl.err(failure) } });
    const write = aborting({ automation: { abortPending: async () => jarl.err(failure) } });

    expect(errorOf(await abort(lookup.needs, "OLI-42", "drive"))).toBe(failure);
    expect(errorOf(await abort(write.needs, "OLI-42", "drive"))).toBe(failure);
    expect([...lookup.asked, ...write.asked]).toEqual([]);
  });

  it("moves a pending diagnose's ticket to Aborted the same way (error)", async () => {
    const { needs, asked } = aborting();

    expect(await abort(needs, "OLI-42", "diagnose")).toEqual(jarl.ok(undefined));
    expect(asked).toEqual(["markAborted OLI-42"]);
  });

  it("keeps the row aborted when the move to Aborted fails, asked once, in one line (error)", async () => {
    const no = jarl.err(refused("linear: moving OLI-42 to Aborted failed"));
    const { needs, asked, lines } = aborting({ linear: { markAborted: [no] } });

    expect(await abort(needs, "OLI-42", "drive")).toEqual(jarl.ok(undefined));
    expect(asked).toEqual(["markAborted OLI-42"]);
    expect(lines).toEqual([
      "[INFO] [OLI-42] automation: aborted pending drive",
      "[ERROR] [OLI-42] automation: move to Aborted failed: linear: moving OLI-42 to Aborted failed",
    ]);
  });
});

describe("aborting a running action once its driver stopped", () => {
  const RUNNING = actionRow({ status: "running" });

  it("closes the row aborted, moves the ticket to Aborted, and is true (happy)", async () => {
    const { needs, asked, finished } = aborting();

    expect(await running(needs, "OLI-42", RUNNING)).toEqual(jarl.ok(true));
    expect(finished).toEqual(["action-1 aborted aborted"]);
    expect(asked).toEqual(["markAborted OLI-42"]);
  });

  it("is false, and moves nothing, for a row closed some other way first (error)", async () => {
    const { needs, asked } = aborting({ automation: { finish: async () => jarl.ok(false) } });

    expect(await running(needs, "OLI-42", RUNNING)).toEqual(jarl.ok(false));
    expect(asked).toEqual([]);
  });

  it("is the failure of a row write that fails, and moves nothing (error)", async () => {
    const failure = refusedWrite("connection reset");
    const { needs, asked } = aborting({ automation: { finish: async () => jarl.err(failure) } });

    expect(errorOf(await running(needs, "OLI-42", RUNNING))).toBe(failure);
    expect(asked).toEqual([]);
  });
});
