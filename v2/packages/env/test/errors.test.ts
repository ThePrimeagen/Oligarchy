import * as jarl from "jarl";
import { describe, expect, expectTypeOf, it } from "vitest";
import * as Errors from "../src/errors.ts";

const keep = Errors.keep(Errors.UsageError, Errors.MissingVariable);

describe("keep", () => {
  it("passes an error the body throws on purpose through as itself (happy)", () => {
    const usage = new Errors.UsageError("unknown flag --nope");
    expect(keep(usage)).toBe(usage);
    expectTypeOf(keep).returns.toEqualTypeOf<
      Errors.UsageError | Errors.MissingVariable | Errors.Unexpected
    >();
  });

  it("turns anything else thrown into Unexpected, keeping the cause (unhappy)", () => {
    const bug = new TypeError("cannot read properties of undefined");
    const kept = keep(bug);
    if (!jarl.error.is(kept, Errors.Unexpected)) {
      throw new Error("expected Unexpected");
    }
    expect(kept.cause).toBe(bug);
    expect(kept.message).toBe("unexpected: cannot read properties of undefined");
    expect(keep("a thrown string").message).toBe("unexpected: a thrown string");
  });

  it("passes an Unexpected through rather than wrapping it twice (unhappy)", () => {
    const unexpected = new Errors.Unexpected(new Error("deep"));
    expect(Errors.keep()(unexpected)).toBe(unexpected);
  });
});

describe("jarl.fn with keep", () => {
  const find = jarl.fn(async (id: string): Promise<string> => {
    if (id === "") {
      throw new Errors.UsageError("--id needs a value");
    }
    if (id === "bug") {
      throw new RangeError("out of range");
    }
    return id;
  }, keep);

  it("resolves the value (happy)", async () => {
    expect(await jarl.unwrap(find("7"))).toBe("7");
  });

  it("resolves a thrown refusal and a thrown bug as results, never a rejection (unhappy)", async () => {
    expect(jarl.error.is(await find(""), Errors.UsageError)).toBe(true);
    expect(jarl.error.is(await find("bug"), Errors.Unexpected)).toBe(true);
  });
});
