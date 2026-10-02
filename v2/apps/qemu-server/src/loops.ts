import * as App from "@oligarchy/app";
import * as Async from "@oligarchy/async";
import * as Fleet from "@oligarchy/fleet";
import * as jarl from "jarl";
import type { Run } from "./environment.ts";
import type { Services } from "./services.ts";
export type Application = App.App<Run, Services[keyof Services]>;
export const setups = async (app: Application) => {
  while (!app.signal.aborted) {
    const locks = await app.services.setupRequests.list();
    if (jarl.is_err(locks)) return locks;
    for (const lock of jarl.value(locks)) {
      const situation = await app.services.setupRequests.inspect(lock.iso, lock.serverUrl);
      if (jarl.is_err(situation)) return situation;
      const found = jarl.value(situation);
      if (
        found !== undefined &&
        found.jobId !== null &&
        found.jobStatus !== null &&
        ["failed", "errored", "aborted", "timed_out"].includes(found.jobStatus)
      ) {
        const removed = await app.services.setupRequests.remove(lock.iso, lock.serverUrl);
        if (jarl.is_err(removed)) return removed;
      }
    }
    await Async.sleep(app.environment.config.qemuServer.setupInterval, app.signal);
  }
  return jarl.ok(undefined);
};
export const forget = async (app: Application) => {
  while (!app.signal.aborted) {
    await Fleet.forget("qemu", app.services, {
      silentFor: app.environment.config.qemuServer.forgetAfter,
      attribution: { location: "qemu-server" },
    });
    await Async.sleep(app.environment.config.qemuServer.forgetInterval, app.signal);
  }
  return jarl.ok(undefined);
};
