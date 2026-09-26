import { Effect } from "effect";
import * as SetupRequests from "@oligarchy/db/setup-requests";
import * as Member from "@oligarchy/fleet/member";
import * as Log from "@oligarchy/log/log";
import * as Sessions from "./sessions.ts";

// Announces this qemu server under `url`: its machines as guests and its slots as jobs. On
// joining it removes this url's setup rows once: a host that comes back must not keep a setup
// lock from the process that died. A removal that fails is retried on the next tick; once it
// lands, later ticks leave an in-flight setup on this live server alone.
export const announce = (url: string, name: string) =>
  Member.announce({
    type: "qemu",
    url,
    name,
    attribution: { location: Log.Locations.server },
    report: Effect.gen(function* () {
      const sessions = yield* Sessions.Sessions;
      return { qemus: yield* sessions.qemus, jobs: yield* sessions.jobs };
    }),
    onJoin: Effect.gen(function* () {
      const setups = yield* SetupRequests.SetupRequestStore;
      const log = yield* Log.Log;
      const removed = yield* setups.removeServer(url);
      if (removed > 0) {
        yield* log.info(`setup cleared; ${url}; ${String(removed)}`, {
          location: Log.Locations.server,
        });
      }
    }),
  });
