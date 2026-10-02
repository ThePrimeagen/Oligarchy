import * as App from "@oligarchy/app";
import * as jarl from "jarl";
import * as Router from "./router.ts";
import * as Loops from "./loops.ts";
import { routes } from "./routes.ts";
/** @param {{ listen: typeof import('@oligarchy/http/serve').listen }} options */
export const main =
  (options) =>
  /** @param {Loops.Application} app */
  async (app) => {
    const { flags, vars, config } = app.environment;
    const router = Router.create(app.services, {
      token: vars.oligarchyToken,
      url: flags.url,
      config,
    });
    const listening = await options.listen(
      routes({
        token: vars.oligarchyToken.reveal(),
        handle: router.handle,
        servers: app.services.servers,
        register: router.register,
      }).fetch,
      { hostname: "127.0.0.1", port: flags.port },
    );
    if (jarl.is_err(listening)) return listening;
    app.services.logger.info(`started on 127.0.0.1:${flags.port}`, { location: "qemu-server" });
    app.sub(new App.App(app.environment).main(Loops.setups));
    app.sub(new App.App(app.environment).main(Loops.forget));
    await App.waitForAbort(app.signal);
    await jarl.value(listening).close();
    await router.shutdown();
    return jarl.ok(undefined);
  };
