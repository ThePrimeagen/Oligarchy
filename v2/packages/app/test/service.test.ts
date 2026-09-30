import { describe, expect, it } from "vitest";
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
});
