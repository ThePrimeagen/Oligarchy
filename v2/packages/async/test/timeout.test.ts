import { getActiveResourcesInfo } from "node:process";
import * as jarl from "jarl";
import { describe, expect, it } from "vitest";
import * as Async from "../src/main.ts";

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const open = () => {
  const clock = Async.clock.manual(0);
  const service = Async.open({ name: "qmp", data: {}, clock });
  return { clock, service };
};

describe("timeout", () => {
  it("returns the run's value when it finishes before the deadline (happy)", async () => {
    const { service } = open();
    const result = await Async.timeout(service, 60_000, async () => jarl.ok("fast"));
    expect(result).toEqual({ ok: true, value: "fast" });
  });

  it("returns TimedOut when the deadline passes first (unhappy)", async () => {
    const { clock, service } = open();
    const pending = Async.timeout(service, 60_000, () => new Promise(() => undefined));
    clock.advance(60_000);
    const result = await pending;
    if (!jarl.error.is(result, Async.TimedOut)) {
      throw new Error("expected TimedOut");
    }
    expect(result.error.service).toBe("qmp");
    expect(result.error.after).toBe(60_000);
    expect(result.error.message).toBe("qmp timed out after 60000ms");
  });

  it("does not cancel the run that lost the deadline (unhappy)", async () => {
    const { clock, service } = open();
    let release: () => void = () => undefined;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    let finished = false;
    const pending = Async.timeout(service, 60_000, async () => {
      await hold;
      finished = true;
      return jarl.ok("late");
    });
    clock.advance(60_000);
    const result = await pending;
    expect(jarl.error.is(result, Async.TimedOut)).toBe(true);
    expect(finished).toBe(false);
    release();
    await flush();
    expect(finished).toBe(true);
    expect(jarl.error.is(result, Async.TimedOut)).toBe(true);
  });

  it("returns Closed when the service closes before the deadline (unhappy)", async () => {
    const { service } = open();
    const pending = Async.timeout(service, 60_000, () => new Promise(() => undefined));
    await Async.close(service);
    const result = await pending;
    if (!jarl.error.is(result, Async.Closed)) {
      throw new Error("expected Closed");
    }
    expect(result.error.service).toBe("qmp");
  });

  it("does not start the run when the service is already closed (unhappy)", async () => {
    const { service } = open();
    await Async.close(service);
    let ran = false;
    const result = await Async.timeout(service, 60_000, async () => {
      ran = true;
      return jarl.ok("x");
    });
    expect(ran).toBe(false);
    expect(jarl.error.is(result, Async.Closed)).toBe(true);
  });

  it("drops the deadline timer when the run finishes first (happy)", async () => {
    const service = Async.open({ name: "qmp", data: {} });
    const timers = () => getActiveResourcesInfo().filter((name) => name === "Timeout").length;
    const before = timers();
    const result = await Async.timeout(service, 60_000, async () => jarl.ok("fast"));
    expect(result).toEqual({ ok: true, value: "fast" });
    expect(timers()).toBe(before);
  });

  it("returns Defect when the run throws before it returns a promise (unhappy)", async () => {
    const { service } = open();
    const result = await Async.timeout(service, 60_000, () => {
      throw new Error("bug");
    });
    if (!jarl.error.is(result, Async.Defect)) {
      throw new Error("expected Defect");
    }
    expect(result.error.message).toBe("defect: bug");
  });

  it("returns a thrown bug as Defect (unhappy)", async () => {
    const { service } = open();
    const result = await Async.timeout(service, 60_000, async () => {
      throw new Error("bug");
    });
    expect(jarl.error.is(result, Async.Defect)).toBe(true);
  });
});
