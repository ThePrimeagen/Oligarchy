import type * as App from "@oligarchy/app";
import type * as Logger from "@oligarchy/logger";
import type * as Stores from "@oligarchy/stores";
import * as jarl from "jarl";
import { attempt } from "./failure.ts";

// Forgets the servers of one kind silent for longer than silentFor milliseconds, with one info
// line per url. A sweep that fails is one error line. The process that reads a kind sweeps it
// (the qemu reverse proxy its fleet, the automation server its clients), as often as it decides.
export const forget = async (
  type: Stores.Servers.ServerType,
  services: App.Needs<Stores.Servers.Servers | Logger.Logger>,
  options: { readonly silentFor: number; readonly attribution: Logger.Attribution },
): Promise<void> => {
  const { servers, logger } = services;
  const { attribution } = options;
  const { silentFor } = options;
  const forgotten = await jarl.or_else(
    attempt({ logger, attribution }, "stale server cleanup failed", () =>
      servers.removeStaleServers(type, silentFor),
    ),
    [],
  );
  for (const url of forgotten) {
    logger.info(
      `server forgotten; ${url} silent for ${String(silentFor / 1_000)} seconds`,
      attribution,
    );
  }
};
