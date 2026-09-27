// Type checks only: check:types fails when one breaks. Nothing here calls main.
import * as jarl from "jarl";
import { describe, expectTypeOf, it } from "vitest";
import * as App from "../src/main.ts";
import { counter, greeter, type Counter, type Greeter } from "./support.ts";

type Reads = { readonly flags: { readonly name: string } };
const environment = { command: "", flags: { name: "ada" } } as const;

describe("App types", () => {
  it("files each service under its key, and keeps the environment's literals", () => {
    const app = new App.App(environment, { counter: counter(), greeter: greeter() });
    expectTypeOf(app.services.counter).toEqualTypeOf<Counter>();
    expectTypeOf(app.services.greeter).toEqualTypeOf<Greeter>();
    expectTypeOf(app.environment.command).toEqualTypeOf<"">();
  });

  it("refuses a wrong services object", () => {
    // @ts-expect-error a greeter is not a counter
    void new App.App(environment, { counter: greeter() });
    // @ts-expect-error clock is not a service
    void new App.App(environment, { clock: counter() });
    // @ts-expect-error a service, not an object of services
    void new App.App(environment, counter());
    // @ts-expect-error the fake has no read
    void new App.App(environment, { counter: { service: "counter", increment: () => undefined } });
  });

  it("checks main against the app", () => {
    const counts = async (app: App.App<Reads, Counter>) => jarl.ok(app.services.counter.read());
    const greets = async (app: App.App<Reads, Greeter>) => jarl.ok(app.services.greeter.greet("x"));
    const readsAge = async (app: App.App<{ readonly flags: { readonly age: number } }, Counter>) =>
      jarl.ok(app.environment.flags.age);
    const app = new App.App(environment, { counter: counter() });
    void (() => app.main(counts));
    void (() => app.main(async () => jarl.ok(undefined)));
    // @ts-expect-error the app has no greeter
    void (() => app.main(greets));
    // @ts-expect-error the environment has no age
    void (() => app.main(readsAge));
  });

  it("checks what main and helpers use", () => {
    const greet = (app: App.Has<Greeter>) => app.services.greeter.greet("x");
    const main = async (app: App.App<Reads, Counter>) => {
      // @ts-expect-error main did not ask for a greeter
      void app.services.greeter;
      // @ts-expect-error greet needs a greeter
      greet(app);
      return jarl.ok(undefined);
    };
    void main;
  });

  it("takes exit handlers that take the reason or nothing", () => {
    const app = new App.App(environment, { counter: counter() });
    app.onExit(() => undefined);
    app.onExit(async (reason) => {
      expectTypeOf(reason).toEqualTypeOf<App.ExitReason>();
    });
    // @ts-expect-error a handler gets the reason, not a number
    app.onExit((count: number) => void count);
  });
});
