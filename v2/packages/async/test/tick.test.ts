import { afterEach, describe, expect, it, vi } from "vitest";
import { tick } from "../src/main.ts";

describe("tick", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls the function each interval (happy)", () => {
    vi.useFakeTimers();
    let calls = 0;
    const cancel = tick(() => {
      calls += 1;
    }, 1_000);

    expect(calls).toBe(0);
    vi.advanceTimersByTime(1_000);
    expect(calls).toBe(1);
    vi.advanceTimersByTime(1_000);
    expect(calls).toBe(2);
    cancel();
  });

  it("stops calling after cancel (unhappy)", () => {
    vi.useFakeTimers();
    let calls = 0;
    const cancel = tick(() => {
      calls += 1;
    }, 1_000);

    vi.advanceTimersByTime(1_000);
    cancel();
    vi.advanceTimersByTime(5_000);
    expect(calls).toBe(1);
  });

  it("does not fire again when cancel is called from the function (unhappy)", () => {
    vi.useFakeTimers();
    let calls = 0;
    let cancel: () => void = () => undefined;
    cancel = tick(() => {
      calls += 1;
      cancel();
    }, 1_000);

    vi.advanceTimersByTime(1_000);
    vi.advanceTimersByTime(5_000);
    expect(calls).toBe(1);
  });

  it("keeps ticking after the function throws (unhappy)", () => {
    vi.useFakeTimers();
    let calls = 0;
    const cancel = tick(() => {
      calls += 1;
      if (calls === 1) {
        throw new Error("boom");
      }
    }, 1_000);

    vi.advanceTimersByTime(1_000);
    vi.advanceTimersByTime(1_000);
    expect(calls).toBe(2);
    cancel();
  });
});
