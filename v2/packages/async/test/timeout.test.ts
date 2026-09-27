import * as jarl from "jarl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Aborted, sleep, TimedOut, timeout } from "../src/main.ts";
import { track } from "./support.ts";

// A call that answers only when its signal aborts, and then only with how it was told to stop.
const hangs = () => {
  const seen: { signal: AbortSignal | undefined } = { signal: undefined };
  const fn = (signal: AbortSignal) => {
    seen.signal = signal;
    return new Promise<jarl.Result<string, never>>(() => undefined);
  };
  return { fn, seen };
};

describe("timeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("is what fn returns when it answers before the deadline (happy)", async () => {
    const result = track(
      timeout(
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 100));
          return jarl.ok("answered");
        },
        1_000,
        new AbortController().signal,
      ),
    );

    await vi.advanceTimersByTimeAsync(100);
    expect(result.value).toEqual(jarl.ok("answered"));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("is TimedOut at the deadline without waiting for fn, and aborts fn's signal (unhappy)", async () => {
    const { fn, seen } = hangs();
    const result = track(timeout(fn, 1_000, new AbortController().signal));

    await vi.advanceTimersByTimeAsync(999);
    expect(result.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    expect(jarl.error.is(result.value, TimedOut)).toBe(true);
    expect(seen.signal?.aborted).toBe(true);
    expect(jarl.error.is(seen.signal?.reason, TimedOut)).toBe(true);
  });

  it("hands fn the caller's abort, and gives back fn's answer to it (unhappy)", async () => {
    const controller = new AbortController();
    const result = track(timeout((signal) => sleep(60_000, signal), 1_000, controller.signal));

    await vi.advanceTimersByTimeAsync(200);
    const reason = new Aborted("SIGINT received");
    controller.abort(reason);
    await vi.advanceTimersByTimeAsync(0);

    expect(result.value).toEqual(jarl.err(reason));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("hands fn a signal already aborted when the caller's already is (unhappy)", async () => {
    const controller = new AbortController();
    const reason = new Aborted("main returned");
    controller.abort(reason);

    const result = await timeout((signal) => sleep(60_000, signal), 1_000, controller.signal);

    expect(result).toEqual(jarl.err(reason));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("still ends at the deadline when fn ignores the caller's abort (unhappy)", async () => {
    const controller = new AbortController();
    const { fn, seen } = hangs();
    const result = track(timeout(fn, 1_000, controller.signal));

    await vi.advanceTimersByTimeAsync(200);
    controller.abort(new Aborted("SIGTERM received"));
    await vi.advanceTimersByTimeAsync(0);
    expect(seen.signal?.aborted).toBe(true);
    expect(result.settled).toBe(false);

    await vi.advanceTimersByTimeAsync(800);
    expect(jarl.error.is(result.value, TimedOut)).toBe(true);
  });

  it("keeps a rejection from fn after the deadline from surfacing (unhappy)", async () => {
    const unhandled: Array<unknown> = [];
    const collect = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", collect);
    try {
      const result = track(
        timeout(
          (signal) =>
            new Promise<jarl.Result<string, never>>((_resolve, reject) => {
              signal.addEventListener("abort", () => {
                setTimeout(() => reject(new Error("late")), 10);
              });
            }),
          1_000,
        ),
      );

      await vi.advanceTimersByTimeAsync(1_000);
      expect(jarl.error.is(result.value, TimedOut)).toBe(true);
      await vi.advanceTimersByTimeAsync(10);
      vi.useRealTimers();
      await new Promise((resolve) => setImmediate(resolve));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", collect);
    }
  });
});
