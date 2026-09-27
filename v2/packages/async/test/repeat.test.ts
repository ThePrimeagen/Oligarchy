import * as jarl from "jarl";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Aborted, repeat } from "../src/main.ts";
import { track } from "./support.ts";

class Boom extends jarl.error.define("Boom") {
  readonly n: number;
  constructor(n: number) {
    super(`boom ${n}`);
    this.n = n;
  }
}

const keep = (error: unknown): Boom => (error instanceof Boom ? error : new Boom(0));

// Fails every call with the call's number, and records when each call was made.
const failing = () => {
  const at: Array<number> = [];
  const fn = async () => {
    at.push(Date.now());
    return jarl.err(new Boom(at.length));
  };
  return { fn, at };
};

describe("repeat", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the result the function returns (happy)", async () => {
    let calls = 0;
    const find = jarl.fn(async (id: string) => {
      calls += 1;
      if (calls < 3) {
        throw new Boom(calls);
      }
      return id;
    }, keep);

    const result = await repeat(find, 3)("7");

    expect(result).toEqual({ ok: true, value: "7" });
    expect(calls).toBe(3);
  });

  it("waits the delay between one call and the next (happy)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const { fn, at } = failing();

    const result = track(repeat(fn, 3, { delay: 2_000 })());
    await vi.advanceTimersByTimeAsync(4_000);

    expect(at).toEqual([0, 2_000, 4_000]);
    expect(result.value).toEqual(jarl.err(new Boom(3)));
  });

  it("stops at the first error errorFilter refuses (unhappy)", async () => {
    const { fn, at } = failing();

    const result = await repeat(fn, 5, { errorFilter: (error) => error.n !== 2 })();

    expect(at).toHaveLength(2);
    expect(result).toEqual(jarl.err(new Boom(2)));
  });

  it("is Aborted and calls no more when the signal aborts during the delay (unhappy)", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const { fn, at } = failing();

    const result = track(repeat(fn, 3, { delay: 2_000, signal: controller.signal })());
    await vi.advanceTimersByTimeAsync(500);
    controller.abort();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(jarl.error.is(result.value, Aborted)).toBe(true);
    expect(at).toHaveLength(1);
  });
});
