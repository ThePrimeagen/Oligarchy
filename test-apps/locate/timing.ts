import * as App from "@oligarchy/app";
import type * as DecisionApi from "@oligarchy/decision-api";

// The decision-api it is handed, telling `record` each decide's wall time in milliseconds.
export const create = App.createService<
  DecisionApi.DecisionApi,
  { readonly record: (ms: number) => void },
  DecisionApi.DecisionApi
>((services, options) => ({
  service: "decision-api",
  decide: async (request) => {
    const started = performance.now();
    const decided = await services["decision-api"].decide(request);
    options.record(Math.round(performance.now() - started));
    return decided;
  },
}));
