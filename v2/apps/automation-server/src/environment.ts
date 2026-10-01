import * as Env from "@oligarchy/env";

export const environment = Env.cli({
  name: "automation-server",
  description:
    "The automation server: hands the pending jobs to live automation clients until SIGINT or SIGTERM, and serves /abort on 127.0.0.1:--port behind OLIGARCHY_TOKEN",
})
  .flags({ port: Env.args.port() })
  .needs("databaseUrl", "oligarchyToken")
  .done();

export type Run = NonNullable<(typeof environment)["runs"]>;
