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

  it("waits the delay each error's decision names before the next call (happy)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const { fn, at } = failing();

    const result = track(
      repeat(fn, 3, { retry: (error) => ({ retry: true, delay: error.n === 1 ? 2_000 : 500 }) })(),
    );
    await vi.advanceTimersByTimeAsync(2_500);

    expect(at).toEqual([0, 2_000, 2_500]);
    expect(result.value).toEqual(jarl.err(new Boom(3)));
  });

  it("stops at the first error its decision refuses (unhappy)", async () => {
    const { fn, at } = failing();

    const result = await repeat(fn, 5, {
      retry: (error) => (error.n === 2 ? { retry: false } : { retry: true, delay: 0 }),
    })();

    expect(at).toHaveLength(2);
    expect(result).toEqual(jarl.err(new Boom(2)));
  });

  it("calls no more than count, even while every decision says retry (unhappy)", async () => {
    const { fn, at } = failing();
    let asked = 0;

    const result = await repeat(fn, 3, {
      retry: () => {
        asked += 1;
        return { retry: true, delay: 0 };
      },
    })();

    expect(at).toHaveLength(3);
    expect(asked).toBe(2);
    expect(result).toEqual(jarl.err(new Boom(3)));
  });

  it("is Aborted and calls no more when the signal aborts during a decision's delay (unhappy)", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const { fn, at } = failing();

    const result = track(
      repeat(fn, 3, {
        retry: () => ({ retry: true, delay: 2_000 }),
        signal: controller.signal,
      })(),
    );
    await vi.advanceTimersByTimeAsync(500);
    controller.abort();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(jarl.error.is(result.value, Aborted)).toBe(true);
    expect(at).toHaveLength(1);
  });
});
