import * as Env from "@oligarchy/env";

export const environment = Env.cli({
  name: "automation-client",
  description:
    "The automation client: serves /reserve, /run and /abort on 127.0.0.1:--port behind OLIGARCHY_TOKEN until SIGINT or SIGTERM",
})
  .flags({ port: Env.args.port() })
  .needs("databaseUrl", "oligarchyToken")
  .done();

export type Run = NonNullable<(typeof environment)["runs"]>;
