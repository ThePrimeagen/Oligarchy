import type * as App from "@oligarchy/app";
import type * as Http from "@oligarchy/http";
import type * as Logger from "@oligarchy/logger";
import type * as Stores from "@oligarchy/stores";
import * as jarl from "jarl";
import * as Abort from "./abort.ts";
type Wants = Http.Http | Logger.Logger | Stores.Servers.Servers | Stores.Tests.Tests;
export const shutdown = async (services: App.Needs<Wants>, options: Abort.Options) => {
  const queue = await services.tests.listJobs();
  if (jarl.is_err(queue)) return queue;
  const aborter = Abort.create(services, {
    ...options,
    reason: options.reason ?? "automation server shutting down",
  });
  const results = await Promise.all(
    jarl.value(queue).running.map((job) => aborter.abort({ jobId: job.id })),
  );
  for (const result of results) {
    if (jarl.is_err(result) && !jarl.error.is(result, Abort.NothingToAbort)) return result;
  }
  return jarl.ok(undefined);
};
