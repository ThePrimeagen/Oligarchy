import * as jarl from "jarl";
import { describe, expect, it } from "vitest";
import * as Async from "../src/main.ts";

class Nope extends jarl.error.define("Nope") {}

describe("open", () => {
  it("returns the caller's data with a name and an open lifetime (happy)", () => {
    const clock = Async.clock.manual(40);
    const service = Async.open({ name: "database", data: { url: "postgres://local" }, clock });
    expect(service.name).toBe("database");
    expect(service.closed).toBe(false);
    expect(service.url).toBe("postgres://local");
    expect(service.now()).toBe(40);
    clock.advance(5);
    expect(service.now()).toBe(45);
  });

  it("is born closed when its parent is already closed (unhappy)", async () => {
    const parent = Async.open({ name: "parent", data: {} });
    await Async.close(parent);
    const child = Async.open({ name: "late", data: { url: "x" }, parent });
    expect(child.closed).toBe(true);
    expect(child.url).toBe("x");
    let ran = false;
    const registered = Async.cleanup(child, async () => {
      ran = true;
      return jarl.ok(undefined);
    });
    expect(jarl.error.is(registered, Async.Closed)).toBe(true);
    expect(ran).toBe(false);
  });

  it("reports a child's failed cleanup on the parent's close (unhappy)", async () => {
    const parent = Async.open({ name: "parent", data: {} });
    const child = Async.open({ name: "child", data: {}, parent });
    Async.cleanup(child, async () => jarl.err(new Nope("disk")));
    const result = await Async.close(parent);
    expect(parent.closed).toBe(true);
    expect(child.closed).toBe(true);
    if (!jarl.error.is(result, Async.CleanupFailed)) {
      throw new Error("expected CleanupFailed");
    }
    expect(result.error.service).toBe("parent");
    const cause = result.error.causes[0];
    if (!jarl.error.is(cause, Async.CleanupFailed)) {
      throw new Error("expected the child's CleanupFailed");
    }
    expect(cause.service).toBe("child");
    expect(cause.causes[0]).toBeInstanceOf(Nope);
  });
});

describe("attempt", () => {
  it("runs and returns the value while the service is open (happy)", async () => {
    const service = Async.open({ name: "database", data: {} });
    const result = await Async.attempt(service, async () => jarl.ok("row"));
    expect(result).toEqual({ ok: true, value: "row" });
  });

  it("returns Closed and does not run when the service is already closed (unhappy)", async () => {
    const service = Async.open({ name: "database", data: {} });
    await Async.close(service);
    let ran = false;
    const result = await Async.attempt(service, async () => {
      ran = true;
      return jarl.ok("row");
    });
    expect(ran).toBe(false);
    if (!jarl.error.is(result, Async.Closed)) {
      throw new Error("expected Closed");
    }
    expect(result.error.service).toBe("database");
    expect(result.error.message).toBe("database is closed");
  });

  it("returns a success that finishes after close, and the next call is Closed (unhappy)", async () => {
    const service = Async.open({ name: "database", data: {} });
    let release: () => void = () => undefined;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered = false;
    const pending = Async.attempt(service, async () => {
      entered = true;
      await hold;
      return jarl.ok("finished");
    });
    expect(entered).toBe(true);
    await Async.close(service);
    release();
    expect(await pending).toEqual({ ok: true, value: "finished" });
    const next = await Async.attempt(service, async () => jarl.ok("nope"));
    expect(jarl.error.is(next, Async.Closed)).toBe(true);
  });

  it("turns a thrown bug into Defect (unhappy)", async () => {
    const service = Async.open({ name: "database", data: {} });
    const result = await Async.attempt(service, async () => {
      throw new Error("bug");
    });
    if (!jarl.error.is(result, Async.Defect)) {
      throw new Error("expected Defect");
    }
    expect(result.error.message).toBe("defect: bug");
    expect(result.error.cause).toBeInstanceOf(Error);
  });
});

describe("requireOpen", () => {
  it("accepts every service it is given when each is open (happy)", () => {
    const log = Async.open({ name: "log", data: {} });
    const db = Async.open({ name: "database", data: { log } });
    expect(Async.requireOpen(db, log)).toEqual({ ok: true, value: undefined });
  });

  it("names the closed dependency and leaves the caller open (unhappy)", async () => {
    const log = Async.open({ name: "log", data: {} });
    const db = Async.open({ name: "database", data: { log } });
    await Async.close(log);
    const result = Async.requireOpen(db, log);
    if (!jarl.error.is(result, Async.Closed)) {
      throw new Error("expected Closed");
    }
    expect(result.error.service).toBe("log");
    expect(db.closed).toBe(false);
  });
});

describe("cleanup and close", () => {
  it("closes an empty service once (happy)", async () => {
    const service = Async.open({ name: "database", data: {} });
    const first = await Async.close(service);
    const second = await Async.close(service);
    expect(first).toEqual({ ok: true, value: undefined });
    expect(second).toBe(first);
    expect(service.closed).toBe(true);
  });

  it("runs cleanups newest first, and children before their parent (happy)", async () => {
    const order: Array<string> = [];
    const parent = Async.open({ name: "parent", data: {} });
    const first = Async.open({ name: "first", data: {}, parent });
    const second = Async.open({ name: "second", data: {}, parent });
    expect(
      Async.cleanup(parent, async () => {
        order.push("parent");
        return jarl.ok(undefined);
      }).ok,
    ).toBe(true);
    expect(
      Async.cleanup(first, async () => {
        order.push("first");
        return jarl.ok(undefined);
      }).ok,
    ).toBe(true);
    expect(
      Async.cleanup(second, async () => {
        order.push("second");
        return jarl.ok(undefined);
      }).ok,
    ).toBe(true);
    expect((await Async.close(parent)).ok).toBe(true);
    expect(order).toEqual(["second", "first", "parent"]);
    expect(first.closed).toBe(true);
    expect(second.closed).toBe(true);
  });

  it("closing a child does not close its parent, and the cleanup runs once (happy)", async () => {
    const parent = Async.open({ name: "parent", data: {} });
    const child = Async.open({ name: "child", data: {}, parent });
    let runs = 0;
    Async.cleanup(child, async () => {
      runs += 1;
      return jarl.ok(undefined);
    });
    expect((await Async.close(child)).ok).toBe(true);
    expect(parent.closed).toBe(false);
    expect((await Async.close(parent)).ok).toBe(true);
    expect(runs).toBe(1);
  });

  it("stays closed when a cleanup fails, and a second close does not run it again (unhappy)", async () => {
    const service = Async.open({ name: "database", data: {} });
    let runs = 0;
    Async.cleanup(service, async () => {
      runs += 1;
      return jarl.err(new Nope("disk"));
    });
    const first = await Async.close(service);
    const second = await Async.close(service);
    expect(service.closed).toBe(true);
    expect(second).toBe(first);
    expect(runs).toBe(1);
    if (!jarl.error.is(first, Async.CleanupFailed)) {
      throw new Error("expected CleanupFailed");
    }
    expect(first.error.service).toBe("database");
    expect(first.error.message).toBe("database cleanup failed");
    expect(first.error.causes).toHaveLength(1);
    expect(first.error.causes[0]).toBeInstanceOf(Nope);
  });

  it("records a thrown cleanup as Defect and still closes (unhappy)", async () => {
    const service = Async.open({ name: "database", data: {} });
    Async.cleanup(service, async () => {
      throw new Error("disk");
    });
    const result = await Async.close(service);
    expect(service.closed).toBe(true);
    if (!jarl.error.is(result, Async.CleanupFailed)) {
      throw new Error("expected CleanupFailed");
    }
    const cause = result.error.causes[0];
    if (!jarl.error.is(cause, Async.Defect)) {
      throw new Error("expected Defect");
    }
    expect(cause.message).toBe("defect: disk");
  });

  it("runs a cleanup once when that cleanup closes the service again (unhappy)", async () => {
    const parent = Async.open({ name: "parent", data: {} });
    const child = Async.open({ name: "child", data: {}, parent });
    let runs = 0;
    Async.cleanup(child, async () => {
      runs += 1;
      void Async.close(parent);
      return jarl.ok(undefined);
    });
    Async.cleanup(parent, async () => {
      runs += 1;
      void Async.close(parent);
      return jarl.ok(undefined);
    });
    expect((await Async.close(parent)).ok).toBe(true);
    expect(runs).toBe(2);
    expect(parent.closed).toBe(true);
    expect(child.closed).toBe(true);
  });

  it("refuses a cleanup registered after close (unhappy)", async () => {
    const service = Async.open({ name: "database", data: {} });
    await Async.close(service);
    let ran = false;
    const registered = Async.cleanup(service, async () => {
      ran = true;
      return jarl.ok(undefined);
    });
    expect(jarl.error.is(registered, Async.Closed)).toBe(true);
    expect(ran).toBe(false);
  });
});

describe("errors stay distinct", () => {
  it("error.is tells Closed, CleanupFailed, TimedOut, Defect and AlreadySettled apart (happy)", () => {
    const closed = new Async.Closed("database");
    const failed = new Async.CleanupFailed("database", [closed]);
    const timedOut = new Async.TimedOut("database", 10);
    const defect = new Async.Defect("bug");
    const settled = new Async.AlreadySettled("database");
    expect(jarl.error.is(closed, Async.Closed)).toBe(true);
    expect(jarl.error.is(closed, Async.CleanupFailed)).toBe(false);
    expect(jarl.error.is(failed, Async.CleanupFailed)).toBe(true);
    expect(jarl.error.is(timedOut, Async.TimedOut)).toBe(true);
    expect(jarl.error.is(defect, Async.Defect)).toBe(true);
    expect(jarl.error.is(settled, Async.AlreadySettled)).toBe(true);
    expect(defect.message).toBe("defect: bug");
  });
});
