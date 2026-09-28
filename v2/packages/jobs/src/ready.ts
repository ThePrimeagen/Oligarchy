import * as Async from "@oligarchy/async";
import * as jarl from "jarl";
import * as Errors from "./errors.ts";
import type { Needs } from "./needs.ts";

// Ready is the label on the ticket of a pending drive or mint; a diagnose is never labeled.

// Linear drops a webhook delivery unanswered after five seconds, and a cold label lookup is up to
// four requests of ten seconds each.
export const MARK_BUDGET_MS = 3_000;

// The action row is already queued whatever Linear answers: one attempt inside the webhook's
// deadline, then the line. The board watch labels a pending action's ticket it finds unlabeled.
export const mark = async (needs: Pick<Needs, "linear" | "logger">, ticket: string) => {
  const marked = await Async.timeout(() => needs.linear.markReady(ticket), { ms: MARK_BUDGET_MS });
  if (marked.ok) {
    return;
  }
  const why = jarl.error.is(marked.error, Async.TimedOut)
    ? `linear: labeling ${ticket} ready failed: no answer within ${String(MARK_BUDGET_MS / 1000)} seconds`
    : Errors.detail(marked.error);
  needs.logger.error(`ready label add failed: ${why}`, {
    location: Errors.AUTOMATION,
    agentId: ticket,
  });
};

// The action row is already closed. A Linear miss must not reopen it; three attempts, then the
// line.
export const release = async (needs: Pick<Needs, "linear" | "logger">, ticket: string) => {
  const cleared = await Async.repeat(() => needs.linear.clearReady(ticket), 3)();
  if (!cleared.ok) {
    needs.logger.error(`ready label clear failed: ${Errors.detail(cleared.error)}`, {
      location: Errors.AUTOMATION,
      agentId: ticket,
    });
  }
};
