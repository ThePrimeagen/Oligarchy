import type * as App from "@oligarchy/app";
import type * as Http from "@oligarchy/http";
import type * as Logger from "@oligarchy/logger";
import * as Stores from "@oligarchy/stores";
import * as jarl from "jarl";
import * as AutomationClient from "./automation-client.ts";
import * as Abort from "./abort.ts";
import * as Close from "./close.ts";
type Wants = Http.Http | Logger.Logger | Stores.Servers.Servers | Stores.Tests.Tests;
export const restart = async (services: App.Needs<Wants>, options: Abort.Options) => {
  const queue = await services.tests.listJobs();
  if (jarl.is_err(queue)) return queue;
  for (const job of jarl.value(queue).running) {
    const found =
      job.serverId === null ? jarl.ok(undefined) : await services.servers.findServer(job.serverId);
    if (jarl.is_err(found)) return found;
    const client = jarl.value(found);
    if (client !== undefined) {
      const stopped = await AutomationClient.create({
        http: services.http,
        url: client.url,
        token: options.token,
        abortTimeoutMs: options.abortTimeoutMs,
      }).post("/abort", { jobId: job.id });
      if (jarl.is_err(stopped)) return jarl.err(new Abort.NotStopped(stopped.error.message));
    }
    // A result committed while we stopped its client retains its result.
    const current = await services.tests.getJob(job.id);
    if (jarl.is_err(current)) return current;
    if (jarl.value(current).status !== "running") continue;
    const reason = "automation server restarted before receiving the job result";
    const ended = await services.tests.errorJob(job.id, reason);
    if (jarl.error.is(ended, Stores.Tests.InvalidState)) continue;
    if (jarl.is_err(ended)) return ended;
    const run = await services.tests.errorRun(job.runId, reason);
    if (jarl.error.is(run, Stores.Tests.InvalidState)) continue;
    if (jarl.is_err(run)) return run;
    const suiteId = jarl.value(run).suiteId;
    if (suiteId !== null) {
      const closed = await Close.closeSuite(services, suiteId);
      if (jarl.is_err(closed)) return closed;
    }
    services.logger.warning(reason, {
      location: "automation-server",
      jobId: job.id,
      runId: job.runId,
    });
  }
  return jarl.ok(undefined);
};
