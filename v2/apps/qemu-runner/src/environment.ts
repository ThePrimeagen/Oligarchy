import * as Env from "@oligarchy/env";
export const environment = Env.cli({
  name: "qemu-runner",
  description: "Owns QEMU guests, setup disks and guest evidence",
})
  .flags({
    port: Env.args.port(),
    url: Env.args.url(),
    name: Env.args.machineName(),
    maxJobs: Env.args.maxJobs(),
    dataDir: Env.args.dataDir(false),
    display: Env.args.display(),
    automation: Env.args.automation(false),
    xDisplay: Env.args.xDisplay(false),
  })
  .needs("databaseUrl", "oligarchyToken")
  .done();
export type Run = NonNullable<(typeof environment)["runs"]>;
