import type * as App from "@oligarchy/app";
import type * as DecisionApi from "@oligarchy/decision-api";
import * as jarl from "jarl";
import type { Run } from "./environment.ts";

export const main =
  (options: { readonly write: (line: string) => void }) =>
  async (app: App.App<Run, DecisionApi.DecisionApi>) => {
    const decided = await app.services["decision-api"].decide({
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
      signal: app.signal,
    });
    if (jarl.is_err(decided)) {
      return decided;
    }
    options.write(JSON.stringify(jarl.value(decided), null, 2));
    return jarl.ok(undefined);
  };
