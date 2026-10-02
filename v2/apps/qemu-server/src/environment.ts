import * as Env from "@oligarchy/env";
export const environment = Env.cli({
  name: "qemu-server",
  description: "Routes job requests to QemuRunners and schedules missing setup disks",
})
  .flags({ port: Env.args.port(), url: Env.args.serverUrl() })
  .needs("databaseUrl", "oligarchyToken")
  .done();
export type Run = NonNullable<(typeof environment)["runs"]>;
