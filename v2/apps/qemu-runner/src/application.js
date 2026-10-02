import * as App from "@oligarchy/app";
import * as jarl from "jarl";
import * as Guests from "./guests.ts";
import * as Loops from "./loops.ts";
import { routes } from "./routes.ts";

/** @param {{ listen: typeof import('@oligarchy/http/serve').listen }} options */
export const main =
  (options) =>
  /** @param {Loops.Application} app */
  async (app) => {
    const { flags, vars, config } = app.environment;
    const { qemu, setupRequests, vmStatus, logger } = app.services;
    const guests = Guests.create(app.services, {
      maxJobs: flags.maxJobs,
      config: config.qemuRunner,
    });
    // Recovery finishes before either serving or advertising capacity.
    const recovered = await qemu.recover(app.signal);
    if (jarl.is_err(recovered)) return recovered;
    const cleared = await vmStatus.clearPastRunningVms(flags.url);
    if (jarl.is_err(cleared)) return cleared;
    const unlocked = await setupRequests.removeServer(flags.url);
    if (jarl.is_err(unlocked)) return unlocked;
    const listening = await options.listen(
      routes({ token: vars.oligarchyToken.reveal(), handle: guests.handle }).fetch,
      { hostname: "127.0.0.1", port: flags.port },
    );
    if (jarl.is_err(listening)) return listening;
    logger.info(`started on 127.0.0.1:${flags.port}; announcing ${flags.url}`, {
      location: "qemu-runner",
    });
    app.sub(new App.App(app.environment).main(Loops.announce(guests)));
    app.sub(new App.App(app.environment).main(Loops.sweep(guests)));
    await App.waitForAbort(app.signal);
    await jarl.value(listening).close();
    const stopped = await guests.shutdown();
    if (jarl.is_err(stopped)) return stopped;
    logger.info("stopped", { location: "qemu-runner" });
    return jarl.ok(undefined);
  };
