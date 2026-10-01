import { Aborted } from "@oligarchy/async";
import * as jarl from "jarl";
import { describe, expect, it } from "vitest";
import * as Jobs from "../src/jobs.ts";

const JOB = "6f1c2c1e-0b7a-4d43-9f6e-2b8f3f0f9a11";
const OTHER = "0d9f4b1a-5c2e-4f7a-8b3d-1e6a9c2f4b70";

// Whether promise has settled once everything already queued has run.
const settled = async (promise: Promise<unknown>): Promise<boolean> => {
  let done = false;
  void promise.then(() => {
    done = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  return done;
};

describe("the jobs an automation client holds", () => {
  it("an abort aborts the job's signal, answers once its holder lets it go, and the job is no longer held (happy)", async () => {
    const jobs = Jobs.create();
    const held = jarl.unwrap(jobs.hold(JOB));
    const other = jarl.unwrap(jobs.hold(OTHER));

    const aborting = jobs.abort({ jobId: JOB });

    expect(held.signal.aborted).toBe(true);
    expect(jarl.error.is(held.signal.reason, Aborted)).toBe(true);
    expect(other.signal.aborted).toBe(false);
    expect(await settled(aborting)).toBe(false);
    held.release();
    expect(await aborting).toBe("stopped");
    expect(await jobs.abort({ jobId: JOB })).toBe("not-held");
    expect(jarl.is_ok(jobs.hold(JOB))).toBe(true);
  });

  it("an abort of a job it does not hold is not-held, and aborts nothing (unhappy)", async () => {
    const jobs = Jobs.create();
    const other = jarl.unwrap(jobs.hold(OTHER));

    const aborted = await jobs.abort({ jobId: JOB });

    expect(aborted).toBe("not-held");
    expect(other.signal.aborted).toBe(false);
  });

  it("holding a job already held is AlreadyHeld, and the first holder keeps it (unhappy)", async () => {
    const jobs = Jobs.create();
    const first = jarl.unwrap(jobs.hold(JOB));

    const again = jobs.hold(JOB);

    expect(jarl.error.is(again, Jobs.AlreadyHeld)).toBe(true);
    expect(jarl.is_err(again) && again.error.message).toBe(`job ${JOB} is already held`);
    expect(first.signal.aborted).toBe(false);
    const aborting = jobs.abort({ jobId: JOB });
    expect(first.signal.aborted).toBe(true);
    first.release();
    expect(await aborting).toBe("stopped");
  });

  it("shutdown aborts every job it holds and settles once each is let go (happy)", async () => {
    const jobs = Jobs.create();
    const held = jarl.unwrap(jobs.hold(JOB));
    const other = jarl.unwrap(jobs.hold(OTHER));

    const shutting = jobs.shutdown();

    expect(held.signal.aborted).toBe(true);
    expect(other.signal.aborted).toBe(true);
    held.release();
    expect(await settled(shutting)).toBe(false);
    other.release();
    await shutting;
    expect(await jobs.abort({ jobId: JOB })).toBe("not-held");
    expect(await jobs.abort({ jobId: OTHER })).toBe("not-held");
  });

  it("a hold once shutdown has begun is ShuttingDown, and the job is never held (unhappy)", async () => {
    const jobs = Jobs.create();
    const held = jarl.unwrap(jobs.hold(JOB));
    const shutting = jobs.shutdown();

    const late = jobs.hold(OTHER);

    expect(jarl.error.is(late, Jobs.ShuttingDown)).toBe(true);
    expect(jarl.is_err(late) && late.error.message).toBe(`shutting down; job ${OTHER} not held`);
    expect(await jobs.abort({ jobId: OTHER })).toBe("not-held");
    held.release();
    await shutting;
  });
});
