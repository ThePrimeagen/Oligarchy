import * as Env from "@oligarchy/env";

export const environment = Env.cli({
  name: "driver",
  description:
    "The driver: drives one drive or setup job's guest at the qemu reverse proxy at --server-url, one model turn at a time, until the model is done, a limit in oligarchy.json is reached, or SIGINT or SIGTERM; then saves a setup that succeeded and stops the guest otherwise. Exits 0 when the drive ran to its end, passed or failed, and 1 when the system failed it",
})
  .flags({ jobId: Env.args.jobId(), serverUrl: Env.args.serverUrl() })
  .needs("databaseUrl", "oligarchyToken", "openRouterToken")
  .done();

export type Run = NonNullable<(typeof environment)["runs"]>;
