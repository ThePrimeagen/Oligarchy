import type * as Db from "@oligarchy/db";
import type * as jarl from "jarl";
import type { Action, Needs } from "./needs.ts";

// An inherited action was taken by the automation server that died: whatever would have closed
// it went with it. A drive or mint whose job its driver closed has finished, and is judged as
// that server would have judged it; nothing is asked of its automation client. Every other
// action, a diagnose included, is stopped at the automation client that took it (`stop`, which
// reports its own failures), then errored and its ticket moved to Errored. No ticket, no client
// recorded, or that client's row gone: nothing to stop.
export const reclaim = async (
  _needs: Pick<
    Needs,
    "tests" | "sessions" | "automation" | "diagnosis" | "servers" | "linear" | "logger"
  >,
  _action: Action,
  _stop: (url: string, ticket: string) => Promise<void>,
): Promise<jarl.Result<void, Db.DatabaseError>> => {
  throw new Error("not implemented");
};
