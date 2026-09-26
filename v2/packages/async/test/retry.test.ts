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

class Skip extends jarl.error.define("Skip") {}

// A macrotask, so every microtask the clock woke has finished before the assertion.
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const open = () => {
  const clock = Async.clock.manual(0);
  const service = Async.open({ name: "jobs", data: {}, clock });
  return { clock, service };
};

describe("retry", () => {
  it("returns the first success and does not wait (happy)", async () => {
    const { clock, service } = open();
    let calls = 0;
    const result = await Async.retry(
      service,
      async () => {
        calls += 1;
        return jarl.ok("moved");
      },
      { attempts: 3, delay: 60_000 },
    );
    expect(result).toEqual({ ok: true, value: "moved" });
    expect(calls).toBe(1);
    clock.advance(60_000);
    expect(calls).toBe(1);
  });

  it("retries until a later attempt succeeds, waiting between them (happy)", async () => {
    const { clock, service } = open();
    const delays: Array<number> = [];
    let calls = 0;
    const pending = Async.retry(
      service,
      async () => {
        calls += 1;
        return calls < 3 ? jarl.err(new Boom(calls)) : jarl.ok("moved");
      },
      {
        attempts: 3,
        delay: (failures) => {
          delays.push(failures);
          return 10;
        },
      },
    );
    await flush();
    expect(calls).toBe(1);
    expect(delays).toEqual([1]);
    clock.advance(10);
    await flush();
    expect(calls).toBe(2);
    expect(delays).toEqual([1, 2]);
    clock.advance(10);
    await flush();
    expect(await pending).toEqual({ ok: true, value: "moved" });
    expect(calls).toBe(3);
  });

  it("returns the last error once the attempts are used (unhappy)", async () => {
    const { clock, service } = open();
    let calls = 0;
    const pending = Async.retry(
      service,
      async () => {
        calls += 1;
        return jarl.err(new Boom(calls));
      },
      { attempts: 3, delay: 10 },
    );
    await flush();
    clock.advance(10);
    await flush();
    clock.advance(10);
    const result = await pending;
    expect(calls).toBe(3);
    if (!jarl.error.is(result, Boom)) {
      throw new Error("expected Boom");
    }
    expect(result.error.n).toBe(3);
  });

  it("does not retry Closed from the attempt (unhappy)", async () => {
    const { service } = open();
    const db = Async.open({ name: "database", data: {} });
    await Async.close(db);
    let calls = 0;
    const result = await Async.retry(
      service,
      async () => {
        calls += 1;
        return jarl.err(new Async.Closed(db.name));
      },
      { attempts: 3, delay: 10 },
    );
    expect(calls).toBe(1);
    if (!jarl.error.is(result, Async.Closed)) {
      throw new Error("expected Closed");
    }
    expect(result.error.service).toBe("database");
  });

  it("returns Closed when the service closes during the delay, and does not try again (unhappy)", async () => {
    const { clock, service } = open();
    let calls = 0;
    const pending = Async.retry(
      service,
      async () => {
        calls += 1;
        return jarl.err(new Boom(calls));
      },
      { attempts: 3, delay: 60_000 },
    );
    await flush();
    expect(calls).toBe(1);
    await Async.close(service);
    const result = await pending;
    clock.advance(60_000);
    await flush();
    expect(calls).toBe(1);
    if (!jarl.error.is(result, Async.Closed)) {
      throw new Error("expected Closed");
    }
    expect(result.error.service).toBe("jobs");
  });

  it("stops without another attempt when retryOn refuses the error (unhappy)", async () => {
    const { service } = open();
    let calls = 0;
    const result = await Async.retry(
      service,
      async () => {
        calls += 1;
        return jarl.err(new Skip("no"));
      },
      { attempts: 3, delay: 0, retryOn: (error) => error instanceof Boom },
    );
    expect(calls).toBe(1);
    expect(jarl.error.is(result, Skip)).toBe(true);
  });

  it("returns Defect when retryOn throws, and does not try again (unhappy)", async () => {
    const { service } = open();
    let calls = 0;
    const result = await Async.retry(
      service,
      async () => {
        calls += 1;
        return jarl.err(new Boom(calls));
      },
      {
        attempts: 3,
        delay: 0,
        retryOn: () => {
          throw new Error("bad predicate");
        },
      },
    );
    expect(calls).toBe(1);
    if (!jarl.error.is(result, Async.Defect)) {
      throw new Error("expected Defect");
    }
    expect(result.error.message).toBe("defect: bad predicate");
  });

  it("returns Defect when the delay function throws (unhappy)", async () => {
    const { service } = open();
    let calls = 0;
    const result = await Async.retry(
      service,
      async () => {
        calls += 1;
        return jarl.err(new Boom(calls));
      },
      {
        attempts: 3,
        delay: () => {
          throw new Error("bad delay");
        },
      },
    );
    expect(calls).toBe(1);
    expect(jarl.error.is(result, Async.Defect)).toBe(true);
  });

  it("returns a thrown bug as Defect and does not retry it (unhappy)", async () => {
    const { service } = open();
    let calls = 0;
    const result = await Async.retry(
      service,
      async () => {
        calls += 1;
        throw new Error("bug");
      },
      { attempts: 3, delay: 0 },
    );
    expect(calls).toBe(1);
    expect(jarl.error.is(result, Async.Defect)).toBe(true);
  });
});
