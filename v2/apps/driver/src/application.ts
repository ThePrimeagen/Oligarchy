import * as App from "@oligarchy/app";
import type * as Http from "@oligarchy/http";
import type * as Logger from "@oligarchy/logger";
import type * as OpenRouter from "@oligarchy/openrouter";
import type * as Stores from "@oligarchy/stores";
import * as jarl from "jarl";
import * as Drive from "./drive.ts";
import type { Run } from "./environment.ts";

// The guest's calls stop with the app: on a signal, or once main returns.
export const main =
  (options: { readonly timedOut: () => void }) =>
  async (
    app: App.App<Run, Logger.Logger | Stores.Tests.Tests | OpenRouter.OpenRouter | Http.Http>,
  ) => {
    const { flags, vars, config } = app.environment;
    const ended = await Drive.drive(app.services, app.signal, {
      jobId: flags.jobId,
      serverUrl: flags.serverUrl,
      token: vars.oligarchyToken,
      config,
    });
    if (jarl.is_err(ended)) {
      return ended;
    }
    if (jarl.value(ended).status === "timed_out") options.timedOut();
    return jarl.ok(undefined);
  };
