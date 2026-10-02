import * as App from "@oligarchy/app";
import type * as Host from "./host.ts";
import type * as Usage from "./usage.ts";

const unexpected = (): never => {
  throw new Error("unexpected fleet call");
};
export const host = (methods: Partial<Omit<Host.Host, "service">>) =>
  App.createService<never, App.NoOptions, Host.Host>(() => ({
    service: "host",
    sample: unexpected,
    collect: unexpected,
    ...methods,
  }))({});
export const usage = (methods: Partial<Omit<Usage.Usage, "service">>) =>
  App.createService<never, App.NoOptions, Usage.Usage>(() => ({
    service: "usage",
    collect: unexpected,
    ...methods,
  }))({});
