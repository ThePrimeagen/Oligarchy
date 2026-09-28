import * as Async from "@oligarchy/async";
import type * as Logger from "@oligarchy/logger";
import type * as Stores from "@oligarchy/stores";
import { attempt } from "./failure.ts";
import { HEARTBEAT_MS } from "./member.ts";

// Forgets, now and then every heartbeat, the servers of one kind silent for ten minutes, with one
// info line per url. The process that reads a kind sweeps it (the qemu reverse proxy its fleet,
// the automation server its clients), so a kind is swept while its reader runs even when none of
// its servers does. A sweep that fails is one error line and the next tick runs. Settles once
// signal aborts and the sweep in flight has said what went.
export const forget = async (
  type: Stores.Servers.ServerType,
  needs: {
    readonly servers: Pick<Stores.Servers.Servers, "removeStaleServers">;
    readonly logger: Logger.Logger;
    readonly attribution: Logger.Attribution;
  },
  signal: AbortSignal,
  options: { readonly every?: number } = {},
): Promise<void> => {
  const { servers, logger, attribution } = needs;
  const sweep = async () => {
    const forgotten = await attempt(needs, "stale server cleanup failed", () =>
      servers.removeStaleServers(type),
    );
    for (const url of forgotten.ok ? forgotten.value : []) {
      logger.info(`server forgotten; ${url} silent for 10 minutes`, attribution);
    }
  };
  await sweep();
  await Async.tick(sweep, options.every ?? HEARTBEAT_MS, signal);
};
