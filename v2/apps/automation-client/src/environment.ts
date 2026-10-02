import * as Env from "@oligarchy/env";

export const environment = Env.cli({
  name: "automation-client",
  description:
    "The automation client: serves /reserve, /run and /abort on 127.0.0.1:--port behind OLIGARCHY_TOKEN until SIGINT or SIGTERM, announced to the fleet as --name under --url; holds up to --max-jobs jobs, a drive's or setup's guest reserved at the qemu server at --server-url",
})
  .flags({
    port: Env.args.port(),
    name: Env.args.machineName(),
    url: Env.args.url(),
    maxJobs: Env.args.maxJobs(),
    serverUrl: Env.args.serverUrl(),
  })
  .needs("databaseUrl", "oligarchyToken")
  .done();

export type Run = NonNullable<(typeof environment)["runs"]>;
