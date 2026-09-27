import type * as App from "../src/main.ts";

// Two services that exist only for these tests.
export type Counter = {
  readonly service: "counter";
  readonly increment: () => void;
  readonly read: () => number;
};
export type Greeter = {
  readonly service: "greeter";
  readonly greet: (name: string) => string;
};

declare module "../src/main.ts" {
  interface Services {
    counter: App.Register<"counter", Counter>;
    greeter: App.Register<"greeter", Greeter>;
  }
}

export const counter = (): Counter => {
  let count = 0;
  return {
    service: "counter",
    increment: () => {
      count += 1;
    },
    read: () => count,
  };
};

export const greeter = (): Greeter => ({ service: "greeter", greet: (name) => `hi ${name}` });
