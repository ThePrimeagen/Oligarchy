import * as jarl from "jarl";
import { describe, expect, it } from "vitest";
import * as Async from "../src/main.ts";

class Boom extends jarl.error.define("Boom") {}

// A macrotask, so every microtask the clock woke has finished before the assertion.
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const open = () => {
  const clock = Async.clock.manual(0);
  const service = Async.open({ name: "member", data: {}, clock });
  return { clock, service };
};

describe("tick", () => {
  it("runs immediately, then again after each interval (happy)", async () => {
    const { clock, service } = open();
    const calls: Array<number> = [];
    const looping = Async.tick(service, 1_000, async () => {
      calls.push(service.now());
      return jarl.ok(undefined);
    });
    await flush();
    expect(calls).toEqual([0]);
    clock.advance(1_000);
    await flush();
    expect(calls).toEqual([0, 1_000]);
    clock.advance(1_000);
    await flush();
    expect(calls).toEqual([0, 1_000, 2_000]);
    await Async.close(service);
    const result = await looping;
    if (!jarl.error.is(result, Async.Closed)) {
      throw new Error("expected Closed");
    }
    expect(result.error.service).toBe("member");
    clock.advance(1_000);
    await flush();
    expect(calls).toEqual([0, 1_000, 2_000]);
  });

  it("waits the interval before the first run when immediate is false (happy)", async () => {
    const { clock, service } = open();
    const calls: Array<number> = [];
    const looping = Async.tick(
      service,
      1_000,
      async () => {
        calls.push(service.now());
        return jarl.ok(undefined);
      },
      { immediate: false },
    );
    await flush();
    expect(calls).toEqual([]);
    clock.advance(1_000);
    await flush();
    expect(calls).toEqual([1_000]);
    await Async.close(service);
    expect(jarl.error.is(await looping, Async.Closed)).toBe(true);
  });

  it("returns the run's error and does not run again (unhappy)", async () => {
    const { clock, service } = open();
    let calls = 0;
    const result = await Async.tick(service, 1_000, async () => {
      calls += 1;
      return jarl.err(new Boom("lost"));
    });
    expect(calls).toBe(1);
    expect(jarl.error.is(result, Boom)).toBe(true);
    clock.advance(1_000);
    await flush();
    expect(calls).toBe(1);
  });

  it("returns Closed when the service closes during the gap, and does not run again (unhappy)", async () => {
    const { clock, service } = open();
    let calls = 0;
    const looping = Async.tick(service, 60_000, async () => {
      calls += 1;
      return jarl.ok(undefined);
    });
    await flush();
    expect(calls).toBe(1);
    await Async.close(service);
    const result = await looping;
    clock.advance(60_000);
    await flush();
    expect(calls).toBe(1);
    if (!jarl.error.is(result, Async.Closed)) {
      throw new Error("expected Closed");
    }
    expect(result.error.service).toBe("member");
  });

  it("lets an in-flight run finish after close, then returns Closed (unhappy)", async () => {
    const { service } = open();
    let release: () => void = () => undefined;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    let finished = false;
    let settled = false;
    const looping = Async.tick(service, 60_000, async () => {
      await hold;
      finished = true;
      return jarl.ok(undefined);
    }).then((result) => {
      settled = true;
      return result;
    });
    await flush();
    expect(finished).toBe(false);
    await Async.close(service);
    await flush();
    expect(settled).toBe(false);
    expect(finished).toBe(false);
    release();
    const result = await looping;
    expect(finished).toBe(true);
    if (!jarl.error.is(result, Async.Closed)) {
      throw new Error("expected Closed");
    }
    expect(result.error.service).toBe("member");
  });

  it("returns Closed when the service closes during a run that then fails (unhappy)", async () => {
    const { service } = open();
    let release: () => void = () => undefined;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const looping = Async.tick(service, 60_000, async () => {
      await hold;
      return jarl.err(new Boom("lost"));
    });
    await flush();
    await Async.close(service);
    release();
    const result = await looping;
    if (!jarl.error.is(result, Async.Closed)) {
      throw new Error("expected Closed");
    }
    expect(result.error.service).toBe("member");
  });

  it("returns a thrown bug as Defect and stops (unhappy)", async () => {
    const { service } = open();
    const result = await Async.tick(service, 1_000, async () => {
      throw new Error("bug");
    });
    expect(jarl.error.is(result, Async.Defect)).toBe(true);
  });
});
