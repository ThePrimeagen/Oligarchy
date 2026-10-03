import type * as App from "@oligarchy/app";
import type * as DecisionApi from "@oligarchy/decision-api";
import type * as Http from "@oligarchy/http";
import * as Locator from "@oligarchy/locator";
import { createClef } from "../shared/clef.ts";
import type { Run } from "./environment.ts";
import * as Timing from "./timing.ts";

export type Services = App.Needs<Http.Http | DecisionApi.DecisionApi | Locator.Locator>;

// oligarchy.json's locator section, with each search flag given in its place.
export const searchOf = (env: Pick<Run, "flags" | "config">): Locator.Options => {
  const { flags, config } = env;
  const file = config.locator;
  return {
    grid: flags.grid ?? file.grid,
    rounds: flags.rounds ?? file.rounds,
    power: flags.power ?? file.power,
    boxScale: flags.boxScale ?? file.boxScale,
    threshold: flags.threshold ?? file.threshold,
    overviewScale: file.overviewScale,
    gridImageScale: file.gridImageScale,
    quality: file.quality,
    callTimeoutMs: file.callTimeout,
    retries: file.retries,
    retryWaitMs: file.retryWait,
  };
};

// The locator asks Clef through a decision-api that tells `record` how long each call took.
export const createServices = (env: Run, record: (ms: number) => void) => {
  const clef = createClef(env, env.flags.model);
  const timed = Timing.create(clef, { record });
  const locator = Locator.create({ "decision-api": timed }, searchOf(env));
  return { http: clef.http, "decision-api": timed, locator } satisfies Services;
};
