import * as Env from "@oligarchy/env";

export const environment = Env.cli({
  name: "automation-server",
  description:
    "The automation server: hands the pending jobs to live automation clients until SIGINT or SIGTERM",
})
  .needs("databaseUrl")
  .done();

export type Run = NonNullable<(typeof environment)["runs"]>;
