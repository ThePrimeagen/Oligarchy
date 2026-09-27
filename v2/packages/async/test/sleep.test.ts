import * as jarl from "jarl";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Aborted, sleep } from "../src/main.ts";
import { track } from "./support.ts";

describe("sleep", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("is ok after the delay, and not before (happy)", async () => {
    vi.useFakeTimers();
    const slept = track(sleep(1_000, new AbortController().signal));

    await vi.advanceTimersByTimeAsync(999);
    expect(slept.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(slept.value).toEqual(jarl.ok(undefined));
  });

  it("is Aborted at once when the signal aborts, with the signal's own Aborted (unhappy)", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const slept = track(sleep(60_000, controller.signal));

    await vi.advanceTimersByTimeAsync(1_000);
    const reason = new Aborted("SIGTERM received");
    controller.abort(reason);
    await vi.advanceTimersByTimeAsync(0);

    expect(slept.settled).toBe(true);
    expect(jarl.error.is(slept.value, Aborted)).toBe(true);
    expect(slept.value).toEqual(jarl.err(reason));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("is Aborted without waiting when the signal already aborted (unhappy)", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    controller.abort("some other reason");

    const slept = await sleep(60_000, controller.signal);

    expect(jarl.error.is(slept, Aborted)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
