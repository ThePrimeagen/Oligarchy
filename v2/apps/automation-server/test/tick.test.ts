import * as jarl from "jarl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TickFailed, TickStopped, tick } from "../src/tick.ts";

const INTERVAL = 30_000;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// Whether a promise has settled, without waiting on it.
const settled = async (promise: Promise<unknown>): Promise<boolean> => {
  let done = false;
  void promise.then(() => {
    done = true;
  });
  await vi.advanceTimersByTimeAsync(0);
  return done;
};

describe("tick", () => {
  it("calls fn once each interval, and a kill mid-sleep ends it at once with ok (happy)", async () => {
    const killer = new AbortController();
    const fn = vi.fn();
    const ticking = tick(fn, INTERVAL, killer.signal);

    await vi.advanceTimersByTimeAsync(INTERVAL - 1);
    expect(fn).toHaveBeenCalledTimes(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(fn).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(INTERVAL / 2);
    killer.abort();

    expect(await settled(ticking.done)).toBe(true);
    expect(jarl.is_ok(await ticking.done)).toBe(true);
    await vi.advanceTimersByTimeAsync(INTERVAL * 3);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("a kill while fn runs waits for fn to finish, then calls it no more (unhappy)", async () => {
    const killer = new AbortController();
    let finish = (): void => undefined;
    const running = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const fn = vi.fn(() => running);
    const ticking = tick(fn, INTERVAL, killer.signal);
    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(fn).toHaveBeenCalledTimes(1);

    killer.abort();

    expect(await settled(ticking.done)).toBe(false);
    finish();
    expect(jarl.is_ok(await ticking.done)).toBe(true);
    await vi.advanceTimersByTimeAsync(INTERVAL * 3);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("already killed, it never calls fn and ends with ok (unhappy)", async () => {
    const killer = new AbortController();
    killer.abort();
    const fn = vi.fn();

    const ticking = tick(fn, INTERVAL, killer.signal);

    expect(await settled(ticking.done)).toBe(true);
    expect(jarl.is_ok(await ticking.done)).toBe(true);
    await vi.advanceTimersByTimeAsync(INTERVAL * 3);
    expect(fn).not.toHaveBeenCalled();
  });

  it("stop wakes the sleep at once, calls fn no more, and ends with TickStopped (unhappy)", async () => {
    const fn = vi.fn();
    const ticking = tick(fn, INTERVAL, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(INTERVAL + INTERVAL / 2);
    expect(fn).toHaveBeenCalledTimes(1);

    ticking.stop();

    expect(await settled(ticking.done)).toBe(true);
    const done = await ticking.done;
    expect(jarl.error.is(done, TickStopped)).toBe(true);
    expect(jarl.is_err(done) && done.error.message).toBe("tick stopped");
    await vi.advanceTimersByTimeAsync(INTERVAL * 3);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("fn throwing ends it with TickFailed naming the message, and fn is called no more (unhappy)", async () => {
    const fn = vi.fn(() => {
      throw new Error("no clients");
    });
    const ticking = tick(fn, INTERVAL, new AbortController().signal);

    await vi.advanceTimersByTimeAsync(INTERVAL);

    const done = await ticking.done;
    expect(jarl.error.is(done, TickFailed)).toBe(true);
    expect(jarl.is_err(done) && done.error.message).toBe("tick failed: no clients");
    await vi.advanceTimersByTimeAsync(INTERVAL * 3);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("fn rejecting ends it the same way (unhappy)", async () => {
    const fn = vi.fn(() => Promise.reject(new Error("database gone")));
    const ticking = tick(fn, INTERVAL, new AbortController().signal);

    await vi.advanceTimersByTimeAsync(INTERVAL);

    const done = await ticking.done;
    expect(jarl.is_err(done) && done.error.message).toBe("tick failed: database gone");
    await vi.advanceTimersByTimeAsync(INTERVAL * 3);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
