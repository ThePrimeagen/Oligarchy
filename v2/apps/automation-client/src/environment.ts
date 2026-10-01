import * as Env from "@oligarchy/env";

export const environment = Env.cli({
  name: "automation-client",
  description:
    "The automation client: serves /reserve, /run and /abort on 127.0.0.1:--port behind OLIGARCHY_TOKEN until SIGINT or SIGTERM, announced to the fleet as --name under --url",
})
  .flags({ port: Env.args.port(), name: Env.args.machineName(), url: Env.args.url() })
  .needs("databaseUrl", "oligarchyToken")
  .done();

export type Run = NonNullable<(typeof environment)["runs"]>;
