import type * as Db from "@oligarchy/db";
import * as jarl from "jarl";
import { close, judge, type Outcome } from "./close.ts";
import { isOpen } from "./find.ts";
import type { Action, Needs } from "./needs.ts";

// The automation server that owned the action is gone. That is the harness, the same way a qemu
// server restart errors the sessions it left, not a run that failed.
const RESTARTED: Outcome = { status: "errored", reason: "automation server restarted" };

const closed = async (
  needs: Parameters<typeof close>[0],
  action: Action,
  outcome: Outcome,
): Promise<jarl.Result<void, Db.DatabaseError>> => {
  const written = await close(needs, action, outcome);
  return written.ok ? jarl.ok(undefined) : written;
};

// An inherited action was taken by the automation server that died: whatever would have closed
// it went with it. A drive or mint whose job its driver closed has finished, and is judged as
// that server would have judged it; nothing is asked of its automation client. Every other
// action, a diagnose included, is stopped at the automation client that took it (`stop`, which
// reports its own failures), then errored and its ticket moved to Errored. No ticket, no client
// recorded, or that client's row gone: nothing to stop.
export const reclaim = async (
  needs: Pick<
    Needs,
    "tests" | "sessions" | "automation" | "diagnosis" | "servers" | "linear" | "logger"
  >,
  action: Action,
  stop: (url: string, ticket: string) => Promise<void>,
): Promise<jarl.Result<void, Db.DatabaseError>> => {
  const job = await needs.tests.findResult(action.resultId);
  if (!job.ok) {
    return job;
  }
  if (action.action !== "diagnose" && job.value !== undefined && !isOpen(job.value)) {
    const outcome = await judge(needs, action);
    return outcome.ok ? closed(needs, action, outcome.value) : outcome;
  }
  const ticket = job.value?.linearId ?? null;
  if (ticket !== null && action.serverId !== null) {
    const client = await needs.servers.findServer(action.serverId);
    if (!client.ok) {
      return client;
    }
    if (client.value !== undefined) {
      await stop(client.value.url, ticket);
    }
  }
  return closed(needs, action, RESTARTED);
};
