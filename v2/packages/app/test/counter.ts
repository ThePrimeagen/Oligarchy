import * as App from "../src/main.ts";

// A service that exists only for these tests, wanting nothing.
export type Counter = {
  readonly service: "counter";
  readonly increment: () => void;
  readonly read: () => number;
};

declare module "../src/main.ts" {
  interface Services {
    counter: App.Register<"counter", Counter>;
  }
}

export const create = App.createService<never, void, Counter>(() => {
  let count = 0;
  return {
    service: "counter",
    increment: () => {
      count += 1;
    },
    read: () => count,
  };
});
