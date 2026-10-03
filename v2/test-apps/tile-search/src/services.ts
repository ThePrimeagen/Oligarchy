import type * as App from "@oligarchy/app";
import * as DecisionApi from "@oligarchy/decision-api";
import * as Http from "@oligarchy/http";
import * as Locator from "@oligarchy/locator";
import type { Run } from "./environment.ts";
import * as Timing from "./timing.ts";

export type Services = App.Needs<Http.Http>;

export type Locators = ReadonlyMap<DecisionApi.Model, App.Made<Locator.Locator>>;

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

// One locator per --model, each asking Clef through a decision-api that tells `record` how long
// each call took.
export const createServices = (env: Run, record: (ms: number) => void) => {
  const http = Http.create({}, { timeoutMs: env.config.httpTimeout });
  const search = searchOf(env);
  const locators: Locators = new Map(
    env.flags.model.map((model) => {
      const decisionApi = DecisionApi.create(
        { http },
        { accountId: env.vars.cloudflareAccountId, token: env.vars.cloudflareApiToken, model },
      );
      const timed = Timing.create({ "decision-api": decisionApi }, { record });
      return [model, Locator.create({ "decision-api": timed }, search)] as const;
    }),
  );
  return { services: { http } satisfies Services, locators };
};
