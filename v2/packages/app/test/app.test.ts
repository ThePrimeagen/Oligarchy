import * as Async from "@oligarchy/async";
import * as jarl from "jarl";
import { describe, expect, it } from "vitest";
import * as App from "../src/main.ts";
import * as Counter from "./counter.ts";
import * as Greeter from "./greeter.ts";

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

// Every list of errors onClose was handed.
const closer = () => {
  const closes: Array<ReadonlyArray<unknown>> = [];
  const onClose = (errors: ReadonlyArray<unknown>) => {
    closes.push(errors);
  };
  return { closes, onClose };
};

const PRESS_AGAIN = "press again to kill the application right away\n";

// Settles once the signal aborts, as a fetch or a sleep handed the signal would.
const aborted = (signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true });
  });

const later = () => new Promise((resolve) => setTimeout(resolve, 0));

const kindOf = (reason: App.ExitReason) => (reason.kind === "signal" ? reason.signal : reason.kind);

const waits = () =>
  new App.App(environment).main(async (started) => {
    await aborted(started.signal);
    return jarl.ok(undefined);
  });

const hangs = () => new App.App(environment).main(() => new Promise<never>(() => undefined));

describe("App", () => {
  it("runs main with its environment and services, closes with no errors, and exits 0 (happy)", async () => {
    const services = { counter: Counter.create({}) };
    const seen: Array<string> = [];
    const app = new App.App(environment).main(async (started: App.App<Reads, Counter.Counter>) => {
      started.services.counter.increment();
      seen.push(started.environment.flags.name);
      return jarl.ok(undefined);
    });
    const { io, codes, listening } = fakeIo();
    const { closes, onClose } = closer();
    await app.run(services, onClose, io);
    expect(seen).toEqual(["ada"]);
    expect(services.counter.read()).toBe(1);
    expect(closes).toEqual([[]]);
    expect(codes).toEqual([0]);
    expect(listening()).toBe(0);
  });

  it("closes with the error main returned, after running the handlers, and exits 1 (unhappy)", async () => {
    const app = new App.App(environment).main(async () => jarl.err("boom"));
    const order: Array<string> = [];
    app.onExit(() => {
      order.push("close");
    });
    const { io, codes } = fakeIo();
    await app.run(
      {},
      (errors) => {
        order.push(`closed with ${errors.join(", ")}`);
      },
      io,
    );
    expect(order).toEqual(["close", "closed with boom"]);
    expect(codes).toEqual([1]);
  });

  it("closes with what main threw, and exits 1 (unhappy)", async () => {
    const thrown = new Error("boom");
    const app = new App.App(environment).main(async () => {
      throw thrown;
    });
    const { io, codes } = fakeIo();
    const { closes, onClose } = closer();
    await app.run({}, onClose, io);
    expect(closes).toEqual([[thrown]]);
    expect(codes).toEqual([1]);
  });

  it("runs exit handlers newest first, each awaited, and skips a removed one (happy)", async () => {
    const app = new App.App(environment).main(async () => jarl.ok(undefined));
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
    const { onClose } = closer();
    await app.run({}, onClose, io);
    expect(order).toEqual(["stop heartbeat", "close services"]);
    expect(codes).toEqual([0]);
  });

  it("runs handlers added during exit one at a time, and waits for the ones they add (unhappy)", async () => {
    const app = new App.App(environment).main(async () => jarl.ok(undefined));
    const order: Array<string> = [];
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
    const { onClose } = closer();
    await app.run({}, onClose, io);
    expect(order).toEqual([
      "first starts",
      "first ends",
      "added starts",
      "added ends",
      "added by the added one",
    ]);
    expect(codes).toEqual([0]);
  });

  it("still runs every handler when one throws or returns an error, closes with both, and exits 1 (unhappy)", async () => {
    const app = new App.App(environment).main(async () => jarl.ok(undefined));
    const thrown = new Error("boom");
    const order: Array<string> = [];
    app.onExit(() => {
      order.push("close services");
    });
    app.onExit(() => jarl.err("could not stop the heartbeat"));
    app.onExit(() => {
      throw thrown;
    });
    const { io, codes } = fakeIo();
    const { closes, onClose } = closer();
    await app.run({}, onClose, io);
    expect(order).toEqual(["close services"]);
    expect(closes).toEqual([[thrown, "could not stop the heartbeat"]]);
    expect(codes).toEqual([1]);
  });

  it("on a signal aborts app.signal, waits for main to return, then runs the handlers (happy)", async () => {
    const order: Array<string> = [];
    const app = new App.App(environment).main(async (started) => {
      await aborted(started.signal);
      order.push("main saw the abort");
      return jarl.ok(undefined);
    });
    app.onExit((reason) => {
      order.push(`close services on ${kindOf(reason)}`);
    });
    const { io, codes, signal, listening } = fakeIo();
    const { closes, onClose } = closer();
    const running = app.run({}, onClose, io);
    expect(app.signal.aborted).toBe(false);
    signal("SIGTERM");
    await running;
    expect(order).toEqual(["main saw the abort", "close services on SIGTERM"]);
    expect(closes).toEqual([[]]);
    expect(codes).toEqual([0]);
    expect(listening()).toBe(0);
  });

  it("on the first C-c tells stderr that pressing again kills the application right away (happy)", async () => {
    const { io, codes, stderr, signal } = fakeIo();
    const { onClose } = closer();
    const running = waits().run({}, onClose, io);
    signal("SIGINT");
    expect(stderr).toEqual([PRESS_AGAIN]);
    await running;
    expect(stderr).toEqual([PRESS_AGAIN]);
    expect(codes).toEqual([0]);
  });

  it("says nothing for SIGTERM or SIGHUP, nor on a C-c that already kills (unhappy)", () => {
    const { onClose } = closer();
    for (const first of ["SIGTERM", "SIGHUP"] as const) {
      const { io, codes, stderr, signal } = fakeIo();
      void hangs().run({}, onClose, io);
      signal(first);
      expect(stderr).toEqual([]);
      signal("SIGINT");
      expect(stderr).toEqual([]);
      expect(codes).toEqual([1]);
    }
    const { io, codes, stderr, signal } = fakeIo();
    void hangs().run({}, onClose, io);
    signal("SIGINT");
    signal("SIGINT");
    expect(stderr).toEqual([PRESS_AGAIN]);
    expect(codes).toEqual([1]);
  });

  it("on SIGHUP aborts, waits for main, then runs the handlers with the hangup as the reason (happy)", async () => {
    const order: Array<string> = [];
    const app = new App.App(environment).main(async (started) => {
      await aborted(started.signal);
      order.push("main saw the abort");
      return jarl.ok(undefined);
    });
    app.onExit((reason) => {
      order.push(`close services on ${kindOf(reason)}`);
    });
    const { io, codes, signal } = fakeIo();
    const { onClose } = closer();
    const running = app.run({}, onClose, io);
    signal("SIGHUP");
    await running;
    expect(order).toEqual(["main saw the abort", "close services on SIGHUP"]);
    expect(codes).toEqual([0]);
  });

  it("takes a SIGTERM after a SIGHUP as the second signal, and exits 1 at once (unhappy)", () => {
    const { io, codes, signal } = fakeIo();
    const { onClose } = closer();
    void hangs().run({}, onClose, io);
    signal("SIGHUP");
    signal("SIGTERM");
    expect(codes).toEqual([1]);
  });

  it("aborts app.signal when main returns, before the handlers run (happy)", async () => {
    const seen: Array<string> = [];
    const app = new App.App(environment).main(async (started) => {
      seen.push(`main sees aborted ${String(started.signal.aborted)}`);
      return jarl.ok(undefined);
    });
    app.onExit(() => {
      seen.push(`handler sees aborted ${String(app.signal.aborted)}`);
    });
    const { io, codes } = fakeIo();
    const { onClose } = closer();
    await app.run({}, onClose, io);
    expect(seen).toEqual(["main sees aborted false", "handler sees aborted true"]);
    expect(jarl.error.is(app.signal.reason, Async.Aborted)).toBe(true);
    expect(codes).toEqual([0]);
  });

  it("holds a handler main adds after a signal until main returns (unhappy)", async () => {
    const order: Array<string> = [];
    const app = new App.App(environment).main(async (started) => {
      await aborted(started.signal);
      started.onExit(() => {
        order.push("added handler");
      });
      await later();
      order.push("main returned");
      return jarl.ok(undefined);
    });
    const { io, codes, signal } = fakeIo();
    const { onClose } = closer();
    const running = app.run({}, onClose, io);
    signal("SIGINT");
    await running;
    expect(order).toEqual(["main returned", "added handler"]);
    expect(codes).toEqual([0]);
  });

  it("takes Aborted from main after a signal as a stop, not an error, and exits 0 (happy)", async () => {
    const app = new App.App(environment).main(async (started) => {
      await aborted(started.signal);
      return jarl.err(new Async.Aborted("stopped"));
    });
    const { io, codes, signal } = fakeIo();
    const { closes, onClose } = closer();
    const running = app.run({}, onClose, io);
    signal("SIGTERM");
    await running;
    expect(closes).toEqual([[]]);
    expect(codes).toEqual([0]);
  });

  it("takes the signal's reason thrown from main as a stop, as an aborted fetch throws it (happy)", async () => {
    const app = new App.App(environment).main(async (started) => {
      await aborted(started.signal);
      started.signal.throwIfAborted();
      return jarl.ok(undefined);
    });
    const { io, codes, signal } = fakeIo();
    const { closes, onClose } = closer();
    const running = app.run({}, onClose, io);
    signal("SIGINT");
    await running;
    expect(closes).toEqual([[]]);
    expect(codes).toEqual([0]);
  });

  it("closes with Aborted when main returns it without a signal, and exits 1 (unhappy)", async () => {
    const app = new App.App(environment).main(async () => jarl.err(new Async.Aborted("stopped")));
    const { io, codes } = fakeIo();
    const { closes, onClose } = closer();
    await app.run({}, onClose, io);
    expect(closes).toHaveLength(1);
    expect(closes[0]).toHaveLength(1);
    expect(jarl.error.is(closes[0]?.[0], Async.Aborted)).toBe(true);
    expect(codes).toEqual([1]);
  });

  it("closes with another error main returns after a signal, and exits 1 (unhappy)", async () => {
    const app = new App.App(environment).main(async (started) => {
      await aborted(started.signal);
      return jarl.err("the stop failed");
    });
    const { io, codes, signal } = fakeIo();
    const { closes, onClose } = closer();
    const running = app.run({}, onClose, io);
    signal("SIGTERM");
    await running;
    expect(closes).toEqual([["the stop failed"]]);
    expect(codes).toEqual([1]);
  });

  it("exits 1 at once on a second signal (unhappy)", () => {
    const app = hangs();
    app.onExit(() => new Promise<void>(() => undefined));
    const { io, codes, signal } = fakeIo();
    const { onClose } = closer();
    void app.run({}, onClose, io);
    signal("SIGINT");
    signal("SIGINT");
    expect(codes).toEqual([1]);
  });

  it("does not cut exit handlers short on a first signal after main returned (unhappy)", async () => {
    const app = new App.App(environment).main(async () => jarl.ok(undefined));
    const order: Array<string> = [];
    const { io, codes, signal } = fakeIo();
    const { onClose } = closer();
    app.onExit(async () => {
      await Promise.resolve();
      signal("SIGINT");
      await Promise.resolve();
      order.push("close services");
    });
    await app.run({}, onClose, io);
    expect(order).toEqual(["close services"]);
    expect(codes).toEqual([0]);
  });

  it("exits 1 once on a second signal, even when main returns afterwards (unhappy)", async () => {
    const { io, codes, signal } = fakeIo();
    const { onClose } = closer();
    const running = waits().run({}, onClose, io);
    signal("SIGINT");
    signal("SIGINT");
    await running;
    expect(codes).toEqual([1]);
  });

  it("does nothing on a second run (unhappy)", async () => {
    let runs = 0;
    const app = new App.App(environment).main(async () => {
      runs += 1;
      return jarl.ok(undefined);
    });
    const { io, codes } = fakeIo();
    const { closes, onClose } = closer();
    await app.run({}, onClose, io);
    await app.run({}, onClose, io);
    expect(runs).toBe(1);
    expect(closes).toEqual([[]]);
    expect(codes).toEqual([0]);
  });

  it("says on stderr that onClose threw, and exits 1 (unhappy)", async () => {
    const app = new App.App(environment).main(async () => jarl.ok(undefined));
    const { io, codes, stderr } = fakeIo();
    await app.run(
      {},
      () => {
        throw new Error("sentry is down");
      },
      io,
    );
    expect(stderr).toEqual(["onClose failed: sentry is down\n"]);
    expect(codes).toEqual([1]);
  });

  it("says on stderr that onClose returned an error, and exits 1 (unhappy)", async () => {
    const app = new App.App(environment).main(async () => jarl.ok(undefined));
    const { io, codes, stderr } = fakeIo();
    await app.run({}, async () => jarl.err("sentry is down"), io);
    expect(stderr).toEqual(["onClose failed: sentry is down\n"]);
    expect(codes).toEqual([1]);
  });
});

describe("App sub-apps", () => {
  // An app that counts, says so, and runs until its signal aborts; its exit handler says why.
  const worker = (name: string, order: Array<string>) => {
    const app = new App.App({ flags: { name } }).main(
      async (started: App.App<Reads, Counter.Counter>) => {
        started.services.counter.increment();
        order.push(`${started.environment.flags.name} runs`);
        await aborted(started.signal);
        return jarl.ok(undefined);
      },
    );
    app.onExit((reason) => {
      order.push(`${name} exits on ${kindOf(reason)}`);
    });
    return app;
  };

  it("runs the tree on the top app's services, then exits children first, left to right (happy)", async () => {
    const order: Array<string> = [];
    const counter = Counter.create({});
    const services = { counter, greeter: Greeter.create({ counter }, { greeting: "hi" }) };
    const a = worker("a", order).sub(worker("a1", order));
    const b = worker("b", order);
    const top = new App.App(environment)
      .main(async (started: App.App<Reads, Counter.Counter | Greeter.Greeter>) => {
        order.push(`top runs and greets ${started.services.greeter.greet("a")}`);
        return jarl.ok(undefined);
      })
      .sub(a)
      .sub(b);
    top.onExit((reason) => {
      order.push(`top exits on ${kindOf(reason)}`);
    });
    const { io, codes } = fakeIo();
    const { closes, onClose } = closer();
    await top.run(services, onClose, io);
    expect(order).toEqual([
      "top runs and greets hi a",
      "a runs",
      "a1 runs",
      "b runs",
      "a1 exits on parent",
      "a exits on parent",
      "b exits on parent",
      "top exits on returned",
    ]);
    expect(services.counter.read()).toBe(3);
    expect(closes).toEqual([[]]);
    expect(codes).toEqual([0]);
  });

  it("closes the top app with every sub-app's error in the order they happened, and the rest carry on (unhappy)", async () => {
    const order: Array<string> = [];
    const thrown = new Error("child threw");
    const failing = new App.App(environment).main(async () => jarl.err("child failed"));
    failing.onExit(() => jarl.err("child could not close"));
    const throwing = new App.App(environment).main(async () => {
      throw thrown;
    });
    const sibling = new App.App(environment).main(async (started) => {
      await aborted(started.signal);
      order.push("sibling carried on");
      return jarl.ok(undefined);
    });
    const top = new App.App(environment)
      .main(async () => {
        await later();
        order.push("top carried on");
        return jarl.ok(undefined);
      })
      .sub(failing)
      .sub(throwing)
      .sub(sibling);
    const { io, codes } = fakeIo();
    const { closes, onClose } = closer();
    await top.run({}, onClose, io);
    expect(order).toEqual(["top carried on", "sibling carried on"]);
    expect(closes).toEqual([["child failed", thrown, "child could not close"]]);
    expect(codes).toEqual([1]);
  });

  it("on a signal aborts every sub-app, then exits them before the top app (unhappy)", async () => {
    const order: Array<string> = [];
    const child = new App.App(environment).main(async (started) => {
      await aborted(started.signal);
      order.push(
        `child saw Aborted ${String(jarl.error.is(started.signal.reason, Async.Aborted))}`,
      );
      return jarl.ok(undefined);
    });
    child.onExit((reason) => {
      order.push(`child exits on ${kindOf(reason)}`);
    });
    const top = waits().sub(child);
    top.onExit((reason) => {
      order.push(`top exits on ${kindOf(reason)}`);
    });
    const { io, codes, signal } = fakeIo();
    const { closes, onClose } = closer();
    const running = top.run({}, onClose, io);
    signal("SIGTERM");
    await running;
    expect(order).toEqual([
      "child saw Aborted true",
      "child exits on parent",
      "top exits on SIGTERM",
    ]);
    expect(closes).toEqual([[]]);
    expect(codes).toEqual([0]);
  });

  it("aborts sub-apps when their parent's main returns, and holds early exits for the children-first pass (unhappy)", async () => {
    const order: Array<string> = [];
    const early = new App.App(environment).main(async () => {
      order.push("early returned");
      return jarl.ok(undefined);
    });
    early.onExit((reason) => {
      order.push(`early exits on ${kindOf(reason)}`);
    });
    const late = new App.App(environment).main(async (started) => {
      await aborted(started.signal);
      await later();
      order.push("late returned");
      return jarl.ok(undefined);
    });
    late.onExit((reason) => {
      order.push(`late exits on ${kindOf(reason)}`);
    });
    const top = new App.App(environment)
      .main(async () => {
        await later();
        order.push("top returned");
        return jarl.ok(undefined);
      })
      .sub(early)
      .sub(late);
    top.onExit((reason) => {
      order.push(`top exits on ${kindOf(reason)}`);
    });
    const { io, codes } = fakeIo();
    const { onClose } = closer();
    await top.run({}, onClose, io);
    expect(order).toEqual([
      "early returned",
      "top returned",
      "late returned",
      "early exits on returned",
      "late exits on parent",
      "top exits on returned",
    ]);
    expect(codes).toEqual([0]);
  });

  it("closes with Aborted when a sub-app returns it though its parent did not stop (unhappy)", async () => {
    const child = new App.App(environment).main(async () => jarl.err(new Async.Aborted("stopped")));
    const top = new App.App(environment)
      .main(async () => {
        await later();
        return jarl.ok(undefined);
      })
      .sub(child);
    const { io, codes } = fakeIo();
    const { closes, onClose } = closer();
    await top.run({}, onClose, io);
    expect(closes[0]).toHaveLength(1);
    expect(jarl.error.is(closes[0]?.[0], Async.Aborted)).toBe(true);
    expect(codes).toEqual([1]);
  });

  it("starts a sub-app added while its parent runs at once, on the parent's services (happy)", async () => {
    const order: Array<string> = [];
    const services = { counter: Counter.create({}) };
    const child = new App.App(environment).main(
      async (started: App.App<Reads, Counter.Counter>) => {
        started.services.counter.increment();
        order.push("child runs");
        return jarl.ok(undefined);
      },
    );
    child.onExit((reason) => {
      order.push(`child exits on ${kindOf(reason)}`);
    });
    const top = new App.App(environment).main(async (started: App.App<Reads, Counter.Counter>) => {
      started.sub(child);
      order.push("child added");
      await later();
      return jarl.ok(undefined);
    });
    top.onExit(() => {
      order.push("top exits");
    });
    const { io, codes } = fakeIo();
    const { closes, onClose } = closer();
    await top.run(services, onClose, io);
    expect(order).toEqual(["child runs", "child added", "child exits on returned", "top exits"]);
    expect(services.counter.read()).toBe(1);
    expect(closes).toEqual([[]]);
    expect(codes).toEqual([0]);
  });

  it("never starts a sub-app added once its parent stopped, but still runs its exit handlers (unhappy)", async () => {
    const order: Array<string> = [];
    const child = new App.App(environment).main(async () => {
      order.push("child runs");
      return jarl.ok(undefined);
    });
    child.onExit((reason) => {
      order.push(`child exits on ${kindOf(reason)}`);
    });
    const top = new App.App(environment).main(async (started) => {
      await aborted(started.signal);
      started.sub(child);
      return jarl.ok(undefined);
    });
    top.onExit((reason) => {
      order.push(`top exits on ${kindOf(reason)}`);
    });
    const { io, codes, signal } = fakeIo();
    const { closes, onClose } = closer();
    const running = top.run({}, onClose, io);
    signal("SIGTERM");
    await running;
    expect(order).toEqual(["child exits on parent", "top exits on SIGTERM"]);
    expect(child.signal.aborted).toBe(true);
    expect(closes).toEqual([[]]);
    expect(codes).toEqual([0]);
  });

  it("still runs the exit handlers of a sub-app added by an exit handler (unhappy)", async () => {
    const order: Array<string> = [];
    const child = new App.App(environment).main(async () => {
      order.push("child runs");
      return jarl.ok(undefined);
    });
    child.onExit((reason) => {
      order.push(`child exits on ${kindOf(reason)}`);
    });
    const top = new App.App(environment).main(async () => jarl.ok(undefined));
    top.onExit(() => {
      top.sub(child);
      order.push("top exits");
    });
    const { io, codes } = fakeIo();
    const { closes, onClose } = closer();
    await top.run({}, onClose, io);
    expect(order).toEqual(["top exits", "child exits on parent"]);
    expect(closes).toEqual([[]]);
    expect(codes).toEqual([0]);
  });

  it("keeps a sub-app with its first parent when another takes it too (unhappy)", async () => {
    let runs = 0;
    const child = new App.App(environment).main(async () => {
      runs += 1;
      return jarl.ok(undefined);
    });
    const first = new App.App(environment).sub(child);
    const second = new App.App(environment).sub(child);
    const { io } = fakeIo();
    const { onClose } = closer();
    await second.run({}, onClose, io);
    expect(runs).toBe(0);
    await first.run({}, onClose, io);
    expect(runs).toBe(1);
  });

  it("refuses to make an app a sub-app of its own tree, and runs it once (unhappy)", async () => {
    let runs = 0;
    const top = new App.App(environment).main(async () => {
      runs += 1;
      return jarl.ok(undefined);
    });
    const child = new App.App(environment);
    void top.sub(child);
    void top.sub(top);
    void child.sub(top);
    const { io, codes } = fakeIo();
    const { closes, onClose } = closer();
    await top.run({}, onClose, io);
    expect(runs).toBe(1);
    expect(closes).toEqual([[]]);
    expect(codes).toEqual([0]);
  });

  it("does nothing when a sub-app is run on its own (unhappy)", async () => {
    let runs = 0;
    const child = new App.App(environment).main(async () => {
      runs += 1;
      return jarl.ok(undefined);
    });
    void new App.App(environment).sub(child);
    const { io, codes, listening } = fakeIo();
    const { closes, onClose } = closer();
    const running = child.run({}, onClose, io);
    expect(listening()).toBe(0);
    await running;
    expect(runs).toBe(0);
    expect(closes).toEqual([]);
    expect(codes).toEqual([]);
  });
});
