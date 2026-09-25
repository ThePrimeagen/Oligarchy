import { Effect, Option } from "effect";
import type * as Automation from "@oligarchy/db/automation";
import * as Servers from "@oligarchy/db/servers";
import * as Tests from "@oligarchy/db/tests";
import * as Close from "./close.ts";
import * as Find from "./find.ts";

// The automation server that owned the action is gone. That is the harness, the same way a qemu
// server restart errors the sessions it left, not a run that failed.
const restarted: Close.Outcome = { status: "errored", reason: "automation server restarted" };

// An inherited action was taken by the automation server that died: the fiber that would have
// closed it went with it. A drive or mint whose job its driver closed has finished, and is judged
// as that fiber would have judged it; nothing is asked of its automation client. Every other
// action, a diagnose included, is stopped at the automation client that took it (the app's
// `stop`, which reports its own failures), then errored and its ticket moved to Errored. No
// ticket, no client recorded, or that client's row gone: nothing to stop. The close is
// uninterruptible, so the row and the ticket finish together even when a shutdown lands.
export const reclaim = <R>(
  action: Automation.AutomationJobRow,
  stop: (url: string, ticket: string) => Effect.Effect<void, never, R>,
) =>
  Effect.gen(function* () {
    const tests = yield* Tests.TestStore;
    const servers = yield* Servers.ServerStore;
    const job = yield* tests.findResult(action.resultId);
    if (action.action !== "diagnose" && Option.isSome(job) && !Find.isOpen(job.value)) {
      const outcome = yield* Close.judge(action);
      yield* Effect.uninterruptible(Close.close(action, outcome));
      return;
    }
    const ticket = Option.isSome(job) ? job.value.linearId : null;
    if (ticket !== null && action.serverId !== null) {
      const client = yield* servers.findServer(action.serverId);
      if (Option.isSome(client)) {
        yield* stop(client.value.url, ticket);
      }
    }
    yield* Effect.uninterruptible(Close.close(action, restarted));
  }).pipe(Effect.withSpan("Reclaim.reclaim"));
