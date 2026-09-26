import * as jarl from "jarl";
import { describe, expect, it } from "vitest";
import * as Async from "../src/main.ts";

const open = () => {
  const clock = Async.clock.manual(0);
  const service = Async.open({ name: "sampler", data: {}, clock });
  return { clock, service };
};

describe("sleep", () => {
  it("resolves once the clock advances the full delay (happy)", async () => {
    const { clock, service } = open();
    const pending = Async.sleep(service, 60_000);
    let settled = false;
    const watched = pending.then((result) => {
      settled = true;
      return result;
    });
    clock.advance(59_999);
    await Promise.resolve();
    expect(settled).toBe(false);
    clock.advance(1);
    expect(await watched).toEqual({ ok: true, value: undefined });
  });

  it("resolves a zero or negative delay without advancing (happy)", async () => {
    const { service } = open();
    expect(await Async.sleep(service, 0)).toEqual({ ok: true, value: undefined });
    expect(await Async.sleep(service, -5)).toEqual({ ok: true, value: undefined });
  });

  it("returns Closed without waiting when the service is already closed (unhappy)", async () => {
    const { clock, service } = open();
    await Async.close(service);
    const result = await Async.sleep(service, 60_000);
    clock.advance(60_000);
    if (!jarl.error.is(result, Async.Closed)) {
      throw new Error("expected Closed");
    }
    expect(result.error.service).toBe("sampler");
  });

  it("returns Closed when the service closes during the wait (unhappy)", async () => {
    const { clock, service } = open();
    const pending = Async.sleep(service, 60_000);
    await Async.close(service);
    const result = await pending;
    clock.advance(60_000);
    if (!jarl.error.is(result, Async.Closed)) {
      throw new Error("expected Closed");
    }
    expect(result.error.service).toBe("sampler");
  });
});
