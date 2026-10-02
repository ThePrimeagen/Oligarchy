import * as Db from "@oligarchy/db";
import * as Stores from "@oligarchy/stores";
import * as jarl from "jarl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEBUG_LOG, frame, JOB, world } from "./support.ts";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("more data", () => {
  it("walks back one frame per call, newest first, and the debug logs are the job's (happy)", async () => {
    const { ctrl, asked } = world();

    const frames = [
      jarl.unwrap(await ctrl.moreData()),
      jarl.unwrap(await ctrl.moreData()),
      jarl.unwrap(await ctrl.moreData()),
    ];
    const debugLog = jarl.unwrap(await ctrl.debugLogs());

    expect(frames).toEqual([frame(0), frame(1), frame(2)]);
    expect(debugLog).toBe(DEBUG_LOG);
    expect(asked).toEqual([
      ["getFrame", JOB, 0],
      ["getFrame", JOB, 1],
      ["getFrame", JOB, 2],
      ["getDebugLog", JOB],
    ]);
  });

  it("returns a frame the store failed to read, and asks for that frame again next time (unhappy)", async () => {
    const error = new Db.DatabaseError("connection refused");
    let calls = 0;
    const { ctrl, asked } = world({
      getFrame: async (_, number) => {
        calls += 1;
        return calls === 1 ? jarl.err(error) : jarl.ok(frame(number));
      },
    });

    const failed = await ctrl.moreData();
    const retried = jarl.unwrap(await ctrl.moreData());

    if (!jarl.error.is(failed, Db.DatabaseError)) {
      throw new Error("expected DatabaseError");
    }
    expect(failed.error).toBe(error);
    expect(retried).toEqual(frame(0));
    expect(asked).toEqual([
      ["getFrame", JOB, 0],
      ["getFrame", JOB, 0],
    ]);
  });

  it("past the oldest frame returns no frame and stays there (unhappy)", async () => {
    const past = new Stores.Logs.NoFrame(`getFrame: job ${JOB} has 1 frames; no frame 1`);
    const { ctrl, asked } = world({
      getFrame: async (_, number) => (number === 0 ? jarl.ok(frame(0)) : jarl.err(past)),
    });

    jarl.unwrap(await ctrl.moreData());
    const ended = await ctrl.moreData();
    const again = await ctrl.moreData();

    for (const got of [ended, again]) {
      if (!jarl.error.is(got, Stores.Logs.NoFrame)) {
        throw new Error("expected NoFrame");
      }
      expect(got.error).toBe(past);
    }
    expect(asked).toEqual([
      ["getFrame", JOB, 0],
      ["getFrame", JOB, 1],
      ["getFrame", JOB, 1],
    ]);
  });
});

describe("debug logs", () => {
  it("the store could not give come back as they came (unhappy)", async () => {
    const none = new Stores.Tests.NotFound(`getDebugLog: no debug log for job ${JOB}`);
    const { ctrl } = world({ getDebugLog: async () => jarl.err(none) });

    const got = await ctrl.debugLogs();

    if (!jarl.error.is(got, Stores.Tests.NotFound)) {
      throw new Error("expected NotFound");
    }
    expect(got.error).toBe(none);
  });
});
