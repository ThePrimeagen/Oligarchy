import * as Env from "@oligarchy/env";

export const environment = Env.cli({
  name: "automation-client",
  description:
    "The automation client: serves /reserve, /run and /abort on 127.0.0.1:--port behind OLIGARCHY_TOKEN until SIGINT or SIGTERM, announced to the fleet as --name under --url; holds up to --max-jobs jobs, a drive's or setup's guest reserved at the qemu reverse proxy at --server-url; runs v2/driver for a drive or setup and opencode for a diagnose, each handed DATABASE_URL, OLIGARCHY_TOKEN and OPENROUTER_API_KEY",
})
  .flags({
    port: Env.args.port(),
    name: Env.args.machineName(),
    url: Env.args.url(),
    maxJobs: Env.args.maxJobs(),
    serverUrl: Env.args.serverUrl(),
  })
  .needs("databaseUrl", "oligarchyToken", "openRouterToken")
  .done();

export type Run = NonNullable<(typeof environment)["runs"]>;
