import * as App from "@oligarchy/app";
import type * as jarl from "jarl";
import type * as Locator from "./main.ts";

type Reply = jarl.Result<Locator.Location, Locator.Failure>;
export type Options = {
  readonly reply: Reply | ((request: Locator.Request) => Reply | Promise<Reply>);
};

// A locator for a consumer's tests: every reply, a found point or any member of Failure, is the
// test's to choose. asked records each request.
export const locator = (
  options: Options,
): {
  readonly locator: App.Made<Locator.Locator>;
  readonly asked: ReadonlyArray<Locator.Request>;
} => {
  const asked: Locator.Request[] = [];
  const create = App.createService<never, App.NoOptions, Locator.Locator>(() => ({
    service: "locator",
    locate: async (request) => {
      asked.push(request);
      return typeof options.reply === "function" ? options.reply(request) : options.reply;
    },
  }));
  return { locator: create({}), asked };
};
