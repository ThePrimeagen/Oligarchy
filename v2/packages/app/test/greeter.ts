import * as App from "../src/main.ts";
import type { Counter } from "./counter.ts";

// A service that exists only for these tests: it wants a counter, which counts its greetings.
export type Greeter = {
  readonly service: "greeter";
  readonly greet: (name: string) => string;
};

export type Options = { readonly greeting: string };

declare module "../src/main.ts" {
  interface Services {
    greeter: App.Register<"greeter", Greeter>;
  }
}

export const create = App.createService<Counter, Options, Greeter>(({ counter }, { greeting }) => ({
  service: "greeter",
  greet: (name) => {
    counter.increment();
    return `${greeting} ${name}`;
  },
}));
