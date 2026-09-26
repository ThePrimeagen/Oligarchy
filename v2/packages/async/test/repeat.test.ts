import * as jarl from "jarl";
import { describe, expect, it } from "vitest";
import { repeat } from "../src/main.ts";

class Boom extends jarl.error.define("Boom") {
  readonly n: number;
  constructor(n: number) {
    super(`boom ${n}`);
    this.n = n;
  }
}

const keep = (error: unknown): Boom => (error instanceof Boom ? error : new Boom(0));

describe("repeat", () => {
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
});
