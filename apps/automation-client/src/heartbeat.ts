import { Effect } from "effect";
import * as Member from "@oligarchy/fleet/member";
import * as Log from "@oligarchy/log/log";
import * as Sessions from "./sessions.ts";

// Announces this automation client under `url`: no guests, since this process boots none, and
// its sessions as jobs.
export const announce = (url: string, name: string) =>
  Member.announce({
    type: "automation-client",
    url,
    name,
    attribution: { location: Log.Locations.automationClient },
    report: Effect.gen(function* () {
      const sessions = yield* Sessions.Sessions;
      return { qemus: 0, jobs: yield* sessions.jobs };
    }),
  });
