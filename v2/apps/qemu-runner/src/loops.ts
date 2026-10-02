import * as App from "@oligarchy/app";
import * as Async from "@oligarchy/async";
import * as Fleet from "@oligarchy/fleet";
import * as jarl from "jarl";
import type { Run } from "./environment.ts";
import type { Guests, Wants } from "./guests.ts";
import type * as Stores from "@oligarchy/stores";
export type Application = App.App<
  Run,
  | Wants
  | Fleet.Host.Host
  | Fleet.Usage.Usage
  | Stores.Servers.Servers
  | Stores.ProcessStats.ProcessStats
  | Stores.SetupRequests.SetupRequests
>;
export const announce = (guests: Guests) => async (app: Application) => {
  const { name, url } = app.environment.flags;
  await Promise.all([
    Fleet.Host.sampling(app.services.host, app.signal),
    Fleet.announce(
      {
        name,
        url,
        type: "qemu",
        attribution: { location: "qemu-runner" },
        report: async () => jarl.ok(guests.counts()),
      },
      app.services,
      app.signal,
    ),
  ]);
  return jarl.ok(undefined);
};
export const sweep = (guests: Guests) => async (app: Application) => {
  while (!app.signal.aborted) {
    await guests.sweep();
    await Async.sleep(app.environment.config.qemuRunner.sweepInterval, app.signal);
  }
  return jarl.ok(undefined);
};
