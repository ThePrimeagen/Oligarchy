import * as jarl from "jarl";
import { describe, expect, it } from "vitest";
import * as Async from "../src/main.ts";

class Boom extends jarl.error.define("Boom") {
  readonly n: number;
  constructor(n: number) {
    super(`boom ${n}`);
    this.n = n;
  }
}

describe("latch", () => {
  it("returns a value that was succeeded before the wait (happy)", async () => {
    const service = Async.open({ name: "qmp", data: {} });
    const held = Async.latch<string, Boom>(service);
    expect(Async.succeed(held, "yes")).toEqual({ ok: true, value: undefined });
    expect(await Async.wait(held)).toEqual({ ok: true, value: "yes" });
  });

  it("returns a value that is succeeded after the wait starts (happy)", async () => {
    const service = Async.open({ name: "qmp", data: {} });
    const held = Async.latch<string, Boom>(service);
    const pending = Async.wait(held);
    expect(Async.succeed(held, "later").ok).toBe(true);
    expect(await pending).toEqual({ ok: true, value: "later" });
  });

  it("keeps the settled value after the service closes (happy)", async () => {
    const service = Async.open({ name: "qmp", data: {} });
    const held = Async.latch<string, Boom>(service);
    Async.succeed(held, "yes");
    await Async.close(service);
    expect(await Async.wait(held)).toEqual({ ok: true, value: "yes" });
  });

  it("returns the error failed into the latch (unhappy)", async () => {
    const service = Async.open({ name: "qmp", data: {} });
    const held = Async.latch<string, Boom>(service);
    const pending = Async.wait(held);
    expect(Async.fail(held, new Boom(1)).ok).toBe(true);
    const result = await pending;
    if (!jarl.error.is(result, Boom)) {
      throw new Error("expected Boom");
    }
    expect(result.error.n).toBe(1);
  });

  it("returns Closed to every waiter when the service closes first (unhappy)", async () => {
    const service = Async.open({ name: "qmp", data: {} });
    const held = Async.latch<string, Boom>(service);
    const first = Async.wait(held);
    const second = Async.wait(held);
    await Async.close(service);
    expect(jarl.error.is(await first, Async.Closed)).toBe(true);
    expect(jarl.error.is(await second, Async.Closed)).toBe(true);
    const late = Async.succeed(held, "too late");
    if (!jarl.error.is(late, Async.Closed)) {
      throw new Error("expected Closed");
    }
    expect(late.error.service).toBe("qmp");
  });

  it("keeps the first value when settled again (unhappy)", async () => {
    const service = Async.open({ name: "qmp", data: {} });
    const held = Async.latch<string, Boom>(service);
    Async.succeed(held, "yes");
    const again = Async.succeed(held, "no");
    const failed = Async.fail(held, new Boom(2));
    if (!jarl.error.is(again, Async.AlreadySettled)) {
      throw new Error("expected AlreadySettled");
    }
    expect(again.error.service).toBe("qmp");
    expect(jarl.error.is(failed, Async.AlreadySettled)).toBe(true);
    expect(await Async.wait(held)).toEqual({ ok: true, value: "yes" });
  });
});
