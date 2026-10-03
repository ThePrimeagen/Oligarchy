// Run from the repository root:
// bun --no-env-file v2/packages/decision-api/src/smoke.ts
import * as Env from "@oligarchy/env";
import * as Http from "@oligarchy/http";
import * as jarl from "jarl";
import * as DecisionApi from "./main.ts";

const run = async (): Promise<void> => {
  const loaded = await Env.create(
    Env.cli({
      name: "decision-api-smoke",
      description: "Make one live Clef decision request",
      sources: Env.source.defaults.map((source): Env.Source => ({
        ...source,
        load: async (io, flags) => {
          const sourceResult = await source.load(io, flags);
          if (jarl.is_err(sourceResult)) return sourceResult;
          const vars = jarl.value(sourceResult);
          return jarl.ok({
            ...vars,
            CLOUDFLARE_ACCOUNT_ID: vars.CLOUDFLARE_ACCOUNT_ID ?? vars.CF_ACC ?? "",
            CLOUDFLARE_API_TOKEN: vars.CLOUDFLARE_API_TOKEN ?? vars.CF_TOKEN ?? "",
          });
        },
      })),
    })
      .needs("cloudflareAccountId", "cloudflareApiToken")
      .done(),
  );
  if (jarl.is_err(loaded)) {
    console.error(loaded.error.message);
    process.exitCode = 1;
    return;
  }
  const env = jarl.value(loaded);
  const services = { http: Http.create({}) };
  const api = DecisionApi.create(services, {
    accountId: env.vars.cloudflareAccountId,
    token: env.vars.cloudflareApiToken,
    model: "clef",
    timeoutMs: 30_000,
  });
  const result = await api.decide({
    state: "i pooped my pants",
    questions: {
      choose: {
        type: "choice",
        instructions: "Choose the best next action for the situation.",
        criteria: {
          "use the bathroom more": null,
          "take a shower": null,
          "compete in lifting competition": null,
        },
      },
    },
  });
  if (jarl.is_err(result)) {
    console.error(
      JSON.stringify(
        Object.assign({ name: result.error.name, message: result.error.message }, result.error),
        null,
        2,
      ),
    );
    process.exitCode = 1;
    return;
  }
  console.log(JSON.stringify(jarl.value(result), null, 2));
};

await run();
