import * as DecisionApi from "@oligarchy/decision-api";
import type * as Env from "@oligarchy/env";
import * as Http from "@oligarchy/http";

// http and a decision-api on it, asking `model`.
export const createClef = (
  env: {
    readonly vars: {
      readonly cloudflareAccountId: string;
      readonly cloudflareApiToken: Env.Secret;
    };
    readonly config: Pick<Env.Config, "httpTimeout">;
  },
  model: DecisionApi.Model,
) => {
  const http = Http.create({}, { timeoutMs: env.config.httpTimeout });
  const decisionApi = DecisionApi.create(
    { http },
    { accountId: env.vars.cloudflareAccountId, token: env.vars.cloudflareApiToken, model },
  );
  return { http, "decision-api": decisionApi };
};
