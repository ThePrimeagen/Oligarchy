import { afterEach, describe, expect, it, vi } from "vitest";
import { sleep } from "../src/main.ts";

describe("sleep", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls the function once after the delay (happy)", () => {
    vi.useFakeTimers();
    let calls = 0;
    const cancel = sleep(() => {
      calls += 1;
    }, 1_000);

    expect(calls).toBe(0);
    vi.advanceTimersByTime(1_000);
    expect(calls).toBe(1);
    vi.advanceTimersByTime(5_000);
    expect(calls).toBe(1);
    cancel();
  });

  it("does not call the function after cancel (unhappy)", () => {
    vi.useFakeTimers();
    let calls = 0;
    const cancel = sleep(() => {
      calls += 1;
    }, 1_000);

    cancel();
    vi.advanceTimersByTime(5_000);
    expect(calls).toBe(0);
  });

  it("keeps the throw inside the timeout (unhappy)", () => {
    vi.useFakeTimers();
    let calls = 0;
    const cancel = sleep(() => {
      calls += 1;
      throw new Error("boom");
    }, 1_000);

    vi.advanceTimersByTime(1_000);
    expect(calls).toBe(1);
    cancel();
  });
});
