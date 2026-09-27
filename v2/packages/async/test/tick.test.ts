import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tick } from "../src/main.ts";
import { track } from "./support.ts";

// A run that takes this long, on the faked clock.
const work = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("tick", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs each interval after the last run ended, never two at once, and hands fn the signal (happy)", async () => {
    const controller = new AbortController();
    const starts: Array<number> = [];
    const signals: Array<AbortSignal> = [];
    const ticking = tick(
      async (signal) => {
        starts.push(Date.now());
        signals.push(signal);
        await work(500);
      },
      1_000,
      controller.signal,
    );

    await vi.advanceTimersByTimeAsync(4_000);
    expect(starts).toEqual([1_000, 2_500, 4_000]);
    expect(signals.every((signal) => signal === controller.signal)).toBe(true);

    controller.abort();
    await vi.advanceTimersByTimeAsync(500);
    await ticking;
  });

  it("settles on abort only once the run in flight returns, and runs no more (unhappy)", async () => {
    const controller = new AbortController();
    let runs = 0;
    const ticking = track(
      tick(
        async () => {
          runs += 1;
          await work(500);
        },
        1_000,
        controller.signal,
      ),
    );

    await vi.advanceTimersByTimeAsync(1_200);
    controller.abort();
    await vi.advanceTimersByTimeAsync(0);
    expect(ticking.settled).toBe(false);

    await vi.advanceTimersByTimeAsync(300);
    expect(ticking.settled).toBe(true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(runs).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps ticking after fn throws or rejects (unhappy)", async () => {
    const controller = new AbortController();
    let runs = 0;
    const ticking = tick(
      (): Promise<void> => {
        runs += 1;
        if (runs === 1) {
          throw new Error("thrown");
        }
        if (runs === 2) {
          return Promise.reject(new Error("rejected"));
        }
        return Promise.resolve();
      },
      1_000,
      controller.signal,
    );

    await vi.advanceTimersByTimeAsync(3_000);
    expect(runs).toBe(3);
    controller.abort();
    await ticking;
  });

  it("settles without a run when the signal already aborted (unhappy)", async () => {
    const controller = new AbortController();
    controller.abort();
    let runs = 0;

    await tick(
      () => {
        runs += 1;
      },
      1_000,
      controller.signal,
    );

    expect(runs).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
