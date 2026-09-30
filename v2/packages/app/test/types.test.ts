// Type checks only: check:types fails when one breaks. Nothing here runs an app.
import * as jarl from "jarl";
import { describe, expectTypeOf, it } from "vitest";
import * as App from "../src/main.ts";
import * as Counters from "./counter.ts";
import * as Greeters from "./greeter.ts";

type Counter = Counters.Counter;
type Greeter = Greeters.Greeter;

type Reads = { readonly flags: { readonly name: string } };
const environment = { command: "", flags: { name: "ada" } } as const;
const closes = () => undefined;
const counter = () => Counters.create({});
const greeter = () => Greeters.create({ counter: counter() }, { greeting: "hi" });

const counts = async (app: App.App<Reads, Counter>) => {
  app.services.counter.increment();
  return jarl.ok(undefined);
};
const greets = async (app: App.App<Reads, Greeter>) => {
  app.services.greeter.greet("x");
  return jarl.ok(undefined);
};
const both = async (app: App.App<Reads, Counter | Greeter>) => {
  app.services.counter.increment();
  app.services.greeter.greet("x");
  return jarl.ok(undefined);
};
const nothing = async () => jarl.ok(undefined);

describe("App types", () => {
  it("types an app by what its main wants, and keeps the environment's literals", () => {
    const app = new App.App(environment).main(both);
    expectTypeOf(app.services.counter).toEqualTypeOf<Counter>();
    expectTypeOf(app.services.greeter).toEqualTypeOf<Greeter>();
    expectTypeOf(app.environment.command).toEqualTypeOf<"">();
    const counting = new App.App(environment).main(counts);
    expectTypeOf(counting.services.counter).toEqualTypeOf<Counter>();
    // @ts-expect-error its main did not ask for a greeter
    void counting.services.greeter;
    // @ts-expect-error an app with no main has no services
    void new App.App(environment).services.counter;
  });

  it("checks main against the app's environment", () => {
    const readsAge = async (app: App.App<{ readonly flags: { readonly age: number } }, Counter>) =>
      jarl.ok(void app.environment.flags.age);
    void new App.App(environment).main(counts);
    // @ts-expect-error the environment has no age
    void new App.App(environment).main(readsAge);
  });

  it("takes a main that returns a Result of nothing, whatever its error", () => {
    const app = new App.App(environment);
    void app.main(async () => jarl.ok(undefined));
    void app.main(async () => jarl.err("any error at all"));
    void app.main(async () => (environment.command === "" ? jarl.ok(undefined) : jarl.err(1)));
    // @ts-expect-error main hands back no value
    void app.main(async () => jarl.ok(1));
    // @ts-expect-error main returns a Result, not nothing
    void app.main(async () => undefined);
    // @ts-expect-error main returns a promise
    void app.main(() => jarl.ok(undefined));
  });

  it("runs on services that cover what main wants, extras included", () => {
    const app = new App.App(environment).main(counts);
    void (() => app.run({ counter: counter() }, closes));
    void (() => app.run({ counter: counter(), greeter: greeter() }, closes));
    void (() => new App.App(environment).run({}, closes));
    void (() => new App.App(environment).main(nothing).run({}, closes));
  });

  it("refuses services that miss what main wants", () => {
    const app = new App.App(environment).main(both);
    // @ts-expect-error the services have no greeter
    void (() => app.run({ counter: counter() }, closes));
    // @ts-expect-error the services have nothing main wants
    void (() => app.run({}, closes));
    const loose: App.Provided = { counter: counter(), greeter: greeter() };
    // @ts-expect-error a Provided object may have no counter or greeter
    void (() => app.run(loose, closes));
  });

  it("refuses a wrong services object", () => {
    const app = new App.App(environment).main(counts);
    // @ts-expect-error a greeter is not a counter
    void (() => app.run({ counter: greeter() }, closes));
    // @ts-expect-error clock is not a service
    void (() => new App.App(environment).run({ clock: counter() }, closes));
    // @ts-expect-error a service, not an object of services
    void (() => app.run(counter(), closes));
    const loose: Counter = { service: "counter", increment: () => undefined, read: () => 0 };
    // @ts-expect-error a counter no create built
    void (() => app.run({ counter: loose }, closes));
    // @ts-expect-error clock is not a service, even beside one that is
    void (() => app.run({ counter: counter(), clock: counter() }, closes));
  });

  it("closes with every error, and needs an onClose that returns nothing or a Result", () => {
    const app = new App.App(environment).main(counts);
    void (() =>
      app.run({ counter: counter() }, (errors) => {
        expectTypeOf(errors).toEqualTypeOf<ReadonlyArray<unknown>>();
      }));
    void (() => app.run({ counter: counter() }, async () => jarl.ok(undefined)));
    void (() => app.run({ counter: counter() }, () => jarl.err("could not report")));
    // @ts-expect-error run needs an onClose
    void (() => app.run({ counter: counter() }));
    // @ts-expect-error the errors are unknown, not numbers
    void (() => app.run({ counter: counter() }, (errors: ReadonlyArray<number>) => void errors));
    // @ts-expect-error onClose hands back no value
    void (() => app.run({ counter: counter() }, () => 1));
  });

  it("takes a sub-app that wants some or none of what its parent's main wants", () => {
    const parent = new App.App(environment).main(both);
    expectTypeOf(parent.sub(new App.App(environment).main(counts))).toEqualTypeOf(parent);
    void parent.sub(new App.App({ flags: { name: "sub" } } as const).main(greets));
    void parent.sub(new App.App(environment).main(both));
    void parent.sub(new App.App(environment).main(nothing));
    void parent.sub(new App.App(environment));
    void new App.App(environment).sub(new App.App(environment).main(nothing));
  });

  it("refuses a sub-app that wants a service its parent's main does not", () => {
    const parent = new App.App(environment).main(counts);
    // @ts-expect-error the parent's main did not ask for a greeter
    void parent.sub(new App.App(environment).main(greets));
    // @ts-expect-error the parent's main did not ask for a greeter, though it asked for a counter
    void parent.sub(new App.App(environment).main(both));
    // @ts-expect-error an app with no main has nothing to hand down
    void new App.App(environment).sub(new App.App(environment).main(counts));
  });

  it("checks a sub-app's own sub-apps against its main, not its parent's", () => {
    const grandparent = new App.App(environment).main(both);
    const child = new App.App(environment).main(counts);
    void grandparent.sub(child);
    void child.sub(new App.App(environment).main(counts));
    // @ts-expect-error the child's main did not ask for a greeter, though its parent's did
    void child.sub(new App.App(environment).main(greets));
  });

  it("checks what main and helpers use", () => {
    const greet = (app: App.Has<Greeter>) => app.services.greeter.greet("x");
    const count = (app: App.Has<Counter>) => app.services.counter.read();
    const main = async (app: App.App<Reads, Counter>) => {
      count(app);
      // @ts-expect-error main did not ask for a greeter
      void app.services.greeter;
      // @ts-expect-error greet needs a greeter
      greet(app);
      return jarl.ok(undefined);
    };
    void main;
  });

  it("hands main and helpers the app's signal, and nobody replaces it", () => {
    const waits = (app: App.Has<Counter>) => app.signal;
    const app = new App.App(environment).main(counts);
    expectTypeOf(waits(app)).toEqualTypeOf<AbortSignal>();
    expectTypeOf(app.signal).toEqualTypeOf<AbortSignal>();
    // @ts-expect-error the signal belongs to the app
    app.signal = new AbortController().signal;
  });

  it("takes exit handlers that return nothing or a Result, now or later", () => {
    const app = new App.App(environment).main(counts);
    app.onExit(() => undefined);
    app.onExit(() => jarl.err("could not close"));
    app.onExit(async () => undefined);
    app.onExit(async (reason) => {
      expectTypeOf(reason).toEqualTypeOf<App.ExitReason>();
      expectTypeOf(reason.kind).toEqualTypeOf<"returned" | "signal" | "parent">();
      return jarl.ok(undefined);
    });
    // @ts-expect-error a handler gets the reason, not a number
    app.onExit((count: number) => void count);
    // @ts-expect-error a handler hands back no value
    app.onExit(() => 1);
  });
});

describe("createService types", () => {
  it("hands a service exactly what it wants and the options it names, and what it builds is a service (happy)", () => {
    void App.createService<Counter, Greeters.Options, Greeter>((services, options) => {
      expectTypeOf(services).toEqualTypeOf<{ readonly counter: Counter }>();
      expectTypeOf(options).toEqualTypeOf<Greeters.Options>();
      return { service: "greeter", greet: (name) => `${options.greeting} ${name}` };
    });
    const counted = counter();
    const greeting = Greeters.create({ counter: counted }, { greeting: "hi" });
    expectTypeOf(greeting).toEqualTypeOf<App.Made<Greeter>>();
    expectTypeOf(greeting.greet).toEqualTypeOf<Greeter["greet"]>();
    const app = new App.App(environment).main(both);
    void (() => app.run({ counter: counted, greeter: greeting }, closes));
  });

  it("refuses a call missing a service it wants (unhappy)", () => {
    // @ts-expect-error a greeter wants a counter
    void Greeters.create({}, { greeting: "hi" });
    // @ts-expect-error a greeter wants its greeting
    void Greeters.create({ counter: counter() }, {});
  });

  it("refuses services handed to a service that wants none (unhappy)", () => {
    // @ts-expect-error a counter wants no service
    void Counters.create({ greeter: greeter() });
  });

  it("refuses the wrong service where one is wanted (unhappy)", () => {
    // @ts-expect-error a greeter is not a counter
    void Greeters.create({ counter: greeter() }, { greeting: "hi" });
  });

  it("refuses a service no create built, to a create and to run (unhappy)", () => {
    const loose: Counter = { service: "counter", increment: () => undefined, read: () => 0 };
    // @ts-expect-error a counter no create built
    void Greeters.create({ counter: loose }, { greeting: "hi" });
    const app = new App.App(environment).main(counts);
    // @ts-expect-error a counter no create built
    void (() => app.run({ counter: loose }, closes));
  });

  it("refuses a service that reads a service it did not want (unhappy)", () => {
    void App.createService<never, void, Counter>((services) => {
      // @ts-expect-error a counter wants nothing
      void services.greeter;
      return { service: "counter", increment: () => undefined, read: () => 0 };
    });
  });

  it("refuses a service that builds something other than the service it names (unhappy)", () => {
    const unread = () => ({ service: "counter" as const, increment: () => undefined });
    const echoes = () => ({ service: "greeter" as const, greet: (name: string) => name });
    // @ts-expect-error a counter reads its count
    void App.createService<never, void, Counter>(unread);
    // @ts-expect-error a greeter is not a counter
    void App.createService<never, void, Counter>(echoes);
  });
});
