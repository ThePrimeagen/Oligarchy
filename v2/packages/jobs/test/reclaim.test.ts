import { randomUUID } from "node:crypto";
import * as jarl from "jarl";
import { describe, expect, it } from "vitest";
import type { Action, Needs } from "../src/needs.ts";
import { reclaim } from "../src/reclaim.ts";
import {
  actionRow,
  database,
  errorOf,
  fakeLinear,
  ISO,
  logging,
  only,
  refusedWrite,
  resultRow,
  storedJob,
} from "./support.ts";

const RESTARTED = "automation server restarted";

// Every need reclaim has, faked: result-1 is open and ticketed OLI-42, and client-1 is the
// automation client that took the action, unless a test says otherwise. `calls` keeps each stop
// and each store write, in order.
const reclaiming = (
  given: {
    readonly tests?: Partial<Needs["tests"]>;
    readonly servers?: Partial<Needs["servers"]>;
  } = {},
) => {
  const { linear, asked } = fakeLinear();
  const { lines, logger } = logging();
  const calls: Array<string> = [];
  const needs = {
    tests: only<Needs["tests"]>({
      findResult: async () => jarl.ok(resultRow({ status: "running" })),
      errorResult: async (id, reason) => {
        calls.push(`errorResult ${id} ${reason}`);
        return jarl.ok(true);
      },
      ...given.tests,
    }),
    sessions: only<Needs["sessions"]>({}),
    automation: only<Needs["automation"]>({
      finish: async (id, status, reason) => {
        calls.push(`finish ${id} ${status} ${String(reason)}`);
        return jarl.ok(true);
      },
    }),
    diagnosis: only<Needs["diagnosis"]>({}),
    servers: only<Needs["servers"]>({
      findServer: async (id) =>
        jarl.ok(id === "client-1" ? { id, url: "http://client-1:7000" } : undefined),
      ...given.servers,
    }),
    linear,
    logger,
  };
  const stop = async (url: string, ticket: string) => {
    calls.push(`stop ${url} ${ticket}`);
  };
  return { needs, stop, asked, lines, calls };
};

const TAKEN: Action = actionRow({ status: "running", serverId: "client-1" });

describe("reclaiming an action the last automation server left running", () => {
  it("judges a drive whose driver closed its job, moving it to Needs Review, stopping nothing (happy)", async () => {
    const stores = await database();
    const { linear, asked } = fakeLinear();
    const { lines, logger } = logging();
    const job = await storedJob(stores, "wifi");
    const sessionId = randomUUID();
    jarl.unwrap(await stores.sessions.insertSession(sessionId, { iso: ISO }, "running"));
    jarl.unwrap(await stores.tests.closeResult(job.id, "passed", null, sessionId));
    const row = jarl.unwrap(await stores.automation.enqueue({ resultId: job.id, action: "drive" }));
    const serverId = randomUUID();
    jarl.unwrap(await stores.automation.markRunning(row.id, serverId));
    const stopped: Array<string> = [];

    const reclaimed = await reclaim(
      { ...stores, linear, logger },
      { ...row, status: "running", serverId },
      async (url) => {
        stopped.push(url);
      },
    );

    expect(reclaimed).toEqual(jarl.ok(undefined));
    expect(stopped).toEqual([]);
    expect(await stores.automation.jobStatus(job.id, "drive")).toEqual(jarl.ok("completed"));
    expect(asked).toEqual(["clearReady OLI-42", "moveToNeedsReview OLI-42"]);
    expect(lines).toEqual(["[INFO] [global] automation: drive completed"]);
  });

  it("stops any other drive at its client, then errors it restarted and moves it to Errored (error)", async () => {
    const { needs, stop, asked, calls } = reclaiming();

    expect(await reclaim(needs, TAKEN, stop)).toEqual(jarl.ok(undefined));
    expect(calls).toEqual([
      "stop http://client-1:7000 OLI-42",
      `finish action-1 errored ${RESTARTED}`,
      `errorResult result-1 ${RESTARTED}`,
    ]);
    expect(asked).toEqual([
      "clearReady OLI-42",
      `moveToErrored OLI-42: drive errored; ${RESTARTED}`,
    ]);
  });

  it("stops and errors a diagnose though its result is closed (error)", async () => {
    const { needs, stop, asked, calls } = reclaiming({
      tests: { findResult: async () => jarl.ok(resultRow({ status: "passed" })) },
    });

    expect(await reclaim(needs, { ...TAKEN, action: "diagnose" }, stop)).toEqual(
      jarl.ok(undefined),
    );
    expect(calls).toEqual([
      "stop http://client-1:7000 OLI-42",
      `finish action-1 errored ${RESTARTED}`,
    ]);
    expect(asked).toEqual([`moveToErrored OLI-42: diagnose errored; ${RESTARTED}`]);
  });

  it("stops nothing with no client recorded, the client's row gone, or no ticket, and still errors it (error)", async () => {
    const unplaced = reclaiming();
    const gone = reclaiming();
    const unticketed = reclaiming({
      tests: { findResult: async () => jarl.ok(resultRow({ status: "running", linearId: null })) },
    });

    await reclaim(unplaced.needs, { ...TAKEN, serverId: null }, unplaced.stop);
    await reclaim(gone.needs, { ...TAKEN, serverId: "client-gone" }, gone.stop);
    await reclaim(unticketed.needs, TAKEN, unticketed.stop);

    for (const each of [unplaced, gone, unticketed]) {
      expect(each.calls).toEqual([
        `finish action-1 errored ${RESTARTED}`,
        `errorResult result-1 ${RESTARTED}`,
      ]);
    }
  });

  it("is the failure of a result or client lookup that fails, and the row stays running (error)", async () => {
    const failure = refusedWrite("connection reset");
    const result = reclaiming({ tests: { findResult: async () => jarl.err(failure) } });
    const client = reclaiming({ servers: { findServer: async () => jarl.err(failure) } });

    expect(errorOf(await reclaim(result.needs, TAKEN, result.stop))).toBe(failure);
    expect(errorOf(await reclaim(client.needs, TAKEN, client.stop))).toBe(failure);
    expect([...result.calls, ...client.calls, ...result.asked, ...client.asked]).toEqual([]);
  });
});
