import type * as Linear from "@oligarchy/linear";
import * as jarl from "jarl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { linearRead, READ_AGAIN_MS } from "../src/retry.ts";
import { errorOf, refused, unavailable } from "./support.ts";

type Read = jarl.Result<string, Linear.LinearError | Linear.LinearUnavailable>;

// A read answering `answers` in turn, counting the times it was asked.
const reading = (...answers: ReadonlyArray<Read>) => {
  const read = async (): Promise<Read> => {
    const next = answers[read.asked] ?? jarl.ok("never asked for");
    read.asked += 1;
    return next;
  };
  read.asked = 0;
  return read;
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a Linear read", () => {
  it("one Linear did not answer is asked again 2 s later, and that answer kept (happy)", async () => {
    const read = reading(jarl.err(unavailable()), jarl.ok("team-1"));

    const answered = linearRead(read);
    await vi.advanceTimersByTimeAsync(READ_AGAIN_MS - 1);
    expect(read.asked).toBe(1);
    await vi.advanceTimersByTimeAsync(1);

    expect(await answered).toEqual(jarl.ok("team-1"));
    expect(read.asked).toBe(2);
  });

  it("a second one Linear did not answer is the failure, asked twice in all (error)", async () => {
    const second = unavailable("linear: request failed: no answer within 10 seconds");
    const read = reading(jarl.err(unavailable()), jarl.err(second));

    const answered = linearRead(read);
    await vi.runAllTimersAsync();

    expect(errorOf(await answered)).toBe(second);
    expect(read.asked).toBe(2);
  });

  it("a refusal is the failure at once, not asked again (error)", async () => {
    const refusal = refused("linear: no team named Oligarchy");
    const read = reading(jarl.err(refusal));

    const answered = linearRead(read);
    await vi.runAllTimersAsync();

    expect(errorOf(await answered)).toBe(refusal);
    expect(read.asked).toBe(1);
  });
});
