import { describe, expect, it } from "vitest";
import * as Async from "../src/main.ts";

describe("manual clock", () => {
  it("starts at the given time and moves only when advanced (happy)", () => {
    const clock = Async.clock.manual(40);
    expect(clock.now()).toBe(40);
    clock.advance(5);
    expect(clock.now()).toBe(45);
  });

  it("resolves a delay once advance reaches its due time (happy)", async () => {
    const clock = Async.clock.manual(0);
    let resolved = false;
    const delay = clock.delay(30);
    const pending = delay.done.then(() => {
      resolved = true;
    });
    clock.advance(29);
    await Promise.resolve();
    expect(resolved).toBe(false);
    clock.advance(1);
    await pending;
    expect(resolved).toBe(true);
    expect(clock.now()).toBe(30);
  });

  it("does not resolve a delay that was stopped (unhappy)", async () => {
    const clock = Async.clock.manual(0);
    let resolved = false;
    const delay = clock.delay(10);
    const pending = delay.done.then(() => {
      resolved = true;
    });
    delay.stop();
    clock.advance(10);
    await Promise.race([pending, Promise.resolve()]);
    expect(resolved).toBe(false);
    expect(clock.now()).toBe(10);
  });
});

describe("system clock", () => {
  it("resolves a short delay on the real timer (happy)", async () => {
    const clock = Async.clock.system();
    const started = clock.now();
    await clock.delay(20).done;
    expect(clock.now() - started).toBeGreaterThanOrEqual(15);
  });

  it("stop keeps the real timer from resolving (unhappy)", async () => {
    const delay = Async.clock.system().delay(10_000);
    delay.stop();
    const raced = await Promise.race([
      delay.done.then(() => "done"),
      new Promise((resolve) => setTimeout(() => resolve("still waiting"), 30)),
    ]);
    expect(raced).toBe("still waiting");
  });
});
