import type { Needs } from "./needs.ts";

// Ready is the label on the ticket of a pending drive or mint; a diagnose is never labeled.

// Linear drops a webhook delivery unanswered after five seconds, and a cold label lookup is up to
// four requests of ten seconds each.
export const MARK_BUDGET_MS = 3_000;

// The action row is already queued whatever Linear answers: one attempt inside the webhook's
// deadline, then the line. The board watch labels a pending action's ticket it finds unlabeled.
export const mark = async (_needs: Pick<Needs, "linear" | "logger">, _ticket: string) => {
  throw new Error("not implemented");
};

// The action row is already closed. A Linear miss must not reopen it; three attempts, then the
// line.
export const release = async (_needs: Pick<Needs, "linear" | "logger">, _ticket: string) => {
  throw new Error("not implemented");
};
