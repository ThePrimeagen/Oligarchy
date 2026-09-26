import * as jarl from "jarl";
import { describe, expect, expectTypeOf, it } from "vitest";
import { repeat } from "../src/main.ts";

class Boom extends jarl.error.define("Boom") {
  readonly n: number;
  constructor(n: number) {
    super(`boom ${n}`);
    this.n = n;
  }
}

class Skip extends jarl.error.define("Skip") {}

const keep = (error: unknown): Boom => (error instanceof Boom ? error : new Boom(0));

describe("repeat", () => {
  it("returns the value and calls the function once (happy)", async () => {
    let calls = 0;
    const find = jarl.fn(async (id: string) => {
      calls += 1;
      return id;
    }, keep);
    const retried = repeat(find, 3);

    expectTypeOf(retried).toEqualTypeOf<(id: string) => Promise<jarl.Result<string, Boom>>>();
    expect(await retried("7")).toEqual({ ok: true, value: "7" });
    expect(calls).toBe(1);
  });

  it("calls again after an error until one succeeds (happy)", async () => {
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

  it("asks the filter before each extra try, and continues when it says yes (happy)", async () => {
    const seen: Array<number> = [];
    let calls = 0;
    const find = jarl.fn(async () => {
      calls += 1;
      if (calls < 3) {
        throw new Boom(calls);
      }
      return "done";
    }, keep);
    const result = await repeat(find, 3, (error) => {
      seen.push(error.n);
      return true;
    })();

    expect(result).toEqual({ ok: true, value: "done" });
    expect(seen).toEqual([1, 2]);
    expect(calls).toBe(3);
  });

  it("returns the last error once count calls have failed (unhappy)", async () => {
    let calls = 0;
    const find = jarl.fn(async () => {
      calls += 1;
      throw new Boom(calls);
    }, keep);
    const result = await repeat(find, 3)();

    expect(calls).toBe(3);
    if (!jarl.error.is(result, Boom)) {
      throw new Error("expected Boom");
    }
    expect(result.error.n).toBe(3);
  });

  it("stops on the error whose filter returns false and does not use the remaining count (unhappy)", async () => {
    let calls = 0;
    const find = jarl.fn(
      async () => {
        calls += 1;
        if (calls === 1) {
          throw new Boom(1);
        }
        throw new Skip("no");
      },
      (error) => (error instanceof Boom || error instanceof Skip ? error : new Boom(0)),
    );
    const result = await repeat(find, 5, (error) => error instanceof Boom)();

    expect(calls).toBe(2);
    expect(jarl.error.is(result, Skip)).toBe(true);
    if (jarl.error.is(result, Skip)) {
      expect(result.error.message).toBe("no");
    }
  });

  it("rejects without calling when count is below 1 (unhappy)", async () => {
    let calls = 0;
    const find = jarl.fn(async () => {
      calls += 1;
      return "x";
    }, keep);
    await expect(repeat(find, 0)()).rejects.toThrow("repeat count must be at least 1");
    expect(calls).toBe(0);
  });

  it("does not ask the filter when no try remains (unhappy)", async () => {
    let asked = 0;
    const find = jarl.fn(async () => {
      throw new Boom(1);
    }, keep);
    const result = await repeat(find, 1, () => {
      asked += 1;
      return true;
    })();

    expect(asked).toBe(0);
    expect(jarl.error.is(result, Boom)).toBe(true);
  });
});
