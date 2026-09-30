import { describe, expect, it } from "vitest";
import * as App from "../src/main.ts";
import * as Counter from "./counter.ts";
import * as Greeter from "./greeter.ts";

describe("createService", () => {
  it("hands the maker the services and options it is given, and returns what the maker built (happy)", () => {
    const counter = Counter.create({});
    const greeter = Greeter.create({ counter }, { greeting: "hello" });

    expect(greeter.service).toBe("greeter");
    expect([greeter.greet("ada"), greeter.greet("grace")]).toEqual(["hello ada", "hello grace"]);
    expect(counter.read()).toBe(2);
  });

  it("hands the maker the very bag it is given, and an empty bag when the options are left out (unhappy)", () => {
    const told: Array<{ readonly retries?: number }> = [];
    const create = App.createService<never, { readonly retries?: number }, Counter.Counter>(
      (_, options) => {
        told.push(options);
        return { service: "counter", increment: () => undefined, read: () => 0 };
      },
    );
    const bag = { retries: 3 };

    create({}, bag);
    create({});

    expect(told[0]).toBe(bag);
    expect(told[1]).toEqual({});
  });
});
