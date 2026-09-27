import * as Async from "@oligarchy/async";
import * as jarl from "jarl";
import { describe, expect, it } from "vitest";
import * as App from "../src/main.ts";
import { counter, type Counter } from "./support.ts";

type Reads = { readonly flags: { readonly name: string } };
const environment = { flags: { name: "ada" } };

// The process as a test drives it: who is listening for signals, every exit code asked for, and
// everything written to stderr.
const fakeIo = () => {
  const codes: Array<number> = [];
  const stderr: Array<string> = [];
  const listeners = new Set<(signal: App.Signal) => void>();
  const io: App.Io = {
    onSignal: (handler) => {
      listeners.add(handler);
      return () => {
        listeners.delete(handler);
      };
    },
    exit: (code) => {
      codes.push(code);
    },
    stderr: (text) => {
      stderr.push(text);
    },
  };
  const signal = (name: App.Signal) => {
    if (listeners.size === 0) {
      throw new Error(`nothing is listening for ${name}`);
    }
    for (const listener of listeners) {
      listener(name);
    }
  };
  return { io, codes, stderr, signal, listening: () => listeners.size };
};

const PRESS_AGAIN = "press again to kill the application right away\n";

// Settles once the signal aborts, as a fetch or a sleep handed the signal would.
const aborted = (signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true });
  });

describe("App", () => {
  it("runs main with its environment and services, then exits 0 (happy)", async () => {
    const main = async (app: App.App<Reads, Counter>) => {
      app.services.counter.increment();
      return jarl.ok(app.environment.flags.name);
    };
    const app = new App.App(environment, { counter: counter() });
    const { io, codes, listening } = fakeIo();
    await app.main(main, io);
    expect(app.services.counter.read()).toBe(1);
    expect(codes).toEqual([0]);
    expect(listening()).toBe(0);
  });

  it("exits 1 when main returns an error, after running the handlers (unhappy)", async () => {
    const app = new App.App(environment, { counter: counter() });
    const ran: Array<string> = [];
    app.onExit(() => {
      ran.push("close");
    });
    const { io, codes } = fakeIo();
    await app.main(async () => jarl.err("boom"), io);
    expect(ran).toEqual(["close"]);
    expect(codes).toEqual([1]);
  });

  it("runs exit handlers newest first, each awaited, and skips a removed one (happy)", async () => {
    const app = new App.App(environment, { counter: counter() });
    const order: Array<string> = [];
    app.onExit(() => {
      order.push("close services");
    });
    app.onExit(async () => {
      await Promise.resolve();
      order.push("stop heartbeat");
    });
    const remove = app.onExit(() => {
      order.push("removed");
    });
    remove();
    const { io, codes } = fakeIo();
    await app.main(async () => jarl.ok(undefined), io);
    expect(order).toEqual(["stop heartbeat", "close services"]);
    expect(codes).toEqual([0]);
  });

  it("runs handlers added during exit one at a time, and waits for the ones they add (unhappy)", async () => {
    const app = new App.App(environment, { counter: counter() });
    const order: Array<string> = [];
    const later = () => new Promise((resolve) => setTimeout(resolve, 0));
    app.onExit(async () => {
      order.push("first starts");
      app.onExit(async () => {
        order.push("added starts");
        app.onExit(async () => {
          await later();
          order.push("added by the added one");
        });
        await later();
        order.push("added ends");
      });
      await later();
      order.push("first ends");
    });
    const { io, codes } = fakeIo();
    await app.main(async () => jarl.ok(undefined), io);
    expect(order).toEqual([
      "first starts",
      "first ends",
      "added starts",
      "added ends",
      "added by the added one",
    ]);
    expect(codes).toEqual([0]);
  });

  it("still runs every handler when one throws, and exits 1 (unhappy)", async () => {
    const app = new App.App(environment, { counter: counter() });
    const order: Array<string> = [];
    app.onExit(() => {
      order.push("close services");
    });
    app.onExit(() => {
      throw new Error("boom");
    });
    const { io, codes } = fakeIo();
    await app.main(async () => jarl.ok(undefined), io);
    expect(order).toEqual(["close services"]);
    expect(codes).toEqual([1]);
  });

  it("on a signal aborts app.signal, waits for main to return, then runs the handlers (happy)", async () => {
    const app = new App.App(environment, { counter: counter() });
    const order: Array<string> = [];
    app.onExit((reason) => {
      order.push(`close services on ${reason.kind === "signal" ? reason.signal : reason.kind}`);
    });
    const { io, codes, signal, listening } = fakeIo();
    const running = app.main(async (started) => {
      await aborted(started.signal);
      order.push("main saw the abort");
      return jarl.ok(undefined);
    }, io);
    expect(app.signal.aborted).toBe(false);
    signal("SIGTERM");
    await running;
    expect(order).toEqual(["main saw the abort", "close services on SIGTERM"]);
    expect(codes).toEqual([0]);
    expect(listening()).toBe(0);
  });

  it("on the first C-c tells stderr that pressing again kills the application right away (happy)", async () => {
    const app = new App.App(environment, { counter: counter() });
    const { io, codes, stderr, signal } = fakeIo();
    const running = app.main(async (started) => {
      await aborted(started.signal);
      return jarl.ok(undefined);
    }, io);
    signal("SIGINT");
    expect(stderr).toEqual([PRESS_AGAIN]);
    await running;
    expect(stderr).toEqual([PRESS_AGAIN]);
    expect(codes).toEqual([0]);
  });

  it("says nothing for SIGTERM or SIGHUP, nor on a C-c that already kills (unhappy)", () => {
    for (const first of ["SIGTERM", "SIGHUP"] as const) {
      const app = new App.App(environment, { counter: counter() });
      const { io, codes, stderr, signal } = fakeIo();
      void app.main(() => new Promise<never>(() => undefined), io);
      signal(first);
      expect(stderr).toEqual([]);
      signal("SIGINT");
      expect(stderr).toEqual([]);
      expect(codes).toEqual([1]);
    }
    const app = new App.App(environment, { counter: counter() });
    const { io, codes, stderr, signal } = fakeIo();
    void app.main(() => new Promise<never>(() => undefined), io);
    signal("SIGINT");
    signal("SIGINT");
    expect(stderr).toEqual([PRESS_AGAIN]);
    expect(codes).toEqual([1]);
  });

  it("on SIGHUP aborts, waits for main, then runs the handlers with the hangup as the reason (happy)", async () => {
    const app = new App.App(environment, { counter: counter() });
    const order: Array<string> = [];
    app.onExit((reason) => {
      order.push(`close services on ${reason.kind === "signal" ? reason.signal : reason.kind}`);
    });
    const { io, codes, signal } = fakeIo();
    const running = app.main(async (started) => {
      await aborted(started.signal);
      order.push("main saw the abort");
      return jarl.ok(undefined);
    }, io);
    signal("SIGHUP");
    await running;
    expect(order).toEqual(["main saw the abort", "close services on SIGHUP"]);
    expect(codes).toEqual([0]);
  });

  it("takes a SIGTERM after a SIGHUP as the second signal, and exits 1 at once (unhappy)", () => {
    const app = new App.App(environment, { counter: counter() });
    const { io, codes, signal } = fakeIo();
    void app.main(() => new Promise<never>(() => undefined), io);
    signal("SIGHUP");
    signal("SIGTERM");
    expect(codes).toEqual([1]);
  });

  it("aborts app.signal when main returns, before the handlers run (happy)", async () => {
    const app = new App.App(environment, { counter: counter() });
    const seen: Array<string> = [];
    app.onExit(() => {
      seen.push(`handler sees aborted ${String(app.signal.aborted)}`);
    });
    const { io, codes } = fakeIo();
    await app.main(async (started) => {
      seen.push(`main sees aborted ${String(started.signal.aborted)}`);
      return jarl.ok(undefined);
    }, io);
    expect(seen).toEqual(["main sees aborted false", "handler sees aborted true"]);
    expect(jarl.error.is(app.signal.reason, Async.Aborted)).toBe(true);
    expect(codes).toEqual([0]);
  });

  it("holds a handler main adds after a signal until main returns (unhappy)", async () => {
    const app = new App.App(environment, { counter: counter() });
    const order: Array<string> = [];
    const { io, codes, signal } = fakeIo();
    const running = app.main(async (started) => {
      await aborted(started.signal);
      started.onExit(() => {
        order.push("added handler");
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      order.push("main returned");
      return jarl.ok(undefined);
    }, io);
    signal("SIGINT");
    await running;
    expect(order).toEqual(["main returned", "added handler"]);
    expect(codes).toEqual([0]);
  });

  it("exits 0 when main returns Aborted after a signal (happy)", async () => {
    const app = new App.App(environment, { counter: counter() });
    const { io, codes, signal } = fakeIo();
    const running = app.main(async (started) => {
      await aborted(started.signal);
      return jarl.err(new Async.Aborted("stopped"));
    }, io);
    signal("SIGTERM");
    await running;
    expect(codes).toEqual([0]);
  });

  it("exits 0 when main throws the signal's reason, as an aborted fetch does (happy)", async () => {
    const app = new App.App(environment, { counter: counter() });
    const { io, codes, signal } = fakeIo();
    const running = app.main(async (started) => {
      await aborted(started.signal);
      started.signal.throwIfAborted();
      return jarl.ok(undefined);
    }, io);
    signal("SIGINT");
    await running;
    expect(codes).toEqual([0]);
  });

  it("exits 1 when main returns Aborted without a signal (unhappy)", async () => {
    const app = new App.App(environment, { counter: counter() });
    const { io, codes } = fakeIo();
    await app.main(async () => jarl.err(new Async.Aborted("stopped")), io);
    expect(codes).toEqual([1]);
  });

  it("exits 1 when main returns another error after a signal (unhappy)", async () => {
    const app = new App.App(environment, { counter: counter() });
    const { io, codes, signal } = fakeIo();
    const running = app.main(async (started) => {
      await aborted(started.signal);
      return jarl.err("the stop failed");
    }, io);
    signal("SIGTERM");
    await running;
    expect(codes).toEqual([1]);
  });

  it("exits 1 at once on a second signal (unhappy)", () => {
    const app = new App.App(environment, { counter: counter() });
    app.onExit(() => new Promise<void>(() => undefined));
    const { io, codes, signal } = fakeIo();
    void app.main(() => new Promise<never>(() => undefined), io);
    signal("SIGINT");
    signal("SIGINT");
    expect(codes).toEqual([1]);
  });

  it("does not cut exit handlers short on a first signal after main returned (unhappy)", async () => {
    const app = new App.App(environment, { counter: counter() });
    const order: Array<string> = [];
    const { io, codes, signal } = fakeIo();
    app.onExit(async () => {
      await Promise.resolve();
      signal("SIGINT");
      await Promise.resolve();
      order.push("close services");
    });
    await app.main(async () => jarl.ok(undefined), io);
    expect(order).toEqual(["close services"]);
    expect(codes).toEqual([0]);
  });

  it("exits 1 once on a second signal, even when main returns afterwards (unhappy)", async () => {
    const app = new App.App(environment, { counter: counter() });
    const { io, codes, signal } = fakeIo();
    const running = app.main(async (started) => {
      await aborted(started.signal);
      return jarl.ok(undefined);
    }, io);
    signal("SIGINT");
    signal("SIGINT");
    await running;
    expect(codes).toEqual([1]);
  });

  it("refuses a second main and runs nothing (unhappy)", async () => {
    const app = new App.App(environment, { counter: counter() });
    const { io, codes } = fakeIo();
    let runs = 0;
    const main = async () => {
      runs += 1;
      return jarl.ok(undefined);
    };
    await app.main(main, io);
    const again = await app.main(main, io);
    expect(jarl.error.is(again, App.MainCalledTwice)).toBe(true);
    expect(runs).toBe(1);
    expect(codes).toEqual([0]);
  });
});
