import * as jarl from "jarl";
import { describe, expect, it } from "vitest";
import * as App from "../src/main.ts";
import { counter, type Counter } from "./support.ts";

type Reads = { readonly flags: { readonly name: string } };
const environment = { flags: { name: "ada" } };

const fakeIo = () => {
  const codes: Array<number> = [];
  let send: (signal: App.Signal) => void = () => undefined;
  const io: App.Io = {
    onSignal: (handler) => {
      send = handler;
      return () => undefined;
    },
    exit: (code) => {
      codes.push(code);
    },
  };
  return { io, codes, signal: (signal: App.Signal) => send(signal) };
};

describe("App", () => {
  it("runs main with its environment and services, then exits 0 (happy)", async () => {
    const main = async (app: App.App<Reads, Counter>) => {
      app.services.counter.increment();
      return jarl.ok(app.environment.flags.name);
    };
    const app = new App.App(environment, { counter: counter() });
    const { io, codes } = fakeIo();
    await app.main(main, io);
    expect(app.services.counter.read()).toBe(1);
    expect(codes).toEqual([0]);
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

  it("on a signal runs the handlers, then waits for main to return, then exits 0 (happy)", async () => {
    const app = new App.App(environment, { counter: counter() });
    const order: Array<string> = [];
    let closed: () => void = () => undefined;
    const services = new Promise<void>((resolve) => {
      closed = resolve;
    });
    app.onExit((reason) => {
      order.push(`close services on ${reason.kind === "signal" ? reason.signal : reason.kind}`);
      closed();
    });
    const { io, codes, signal } = fakeIo();
    const running = app.main(async () => {
      await services;
      order.push("main returned");
      return jarl.ok(undefined);
    }, io);
    signal("SIGTERM");
    await running;
    expect(order).toEqual(["close services on SIGTERM", "main returned"]);
    expect(codes).toEqual([0]);
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
