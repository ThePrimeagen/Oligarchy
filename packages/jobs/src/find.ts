import { Effect, Option } from "effect";
import * as Automation from "@oligarchy/db/automation";
import type * as DbSchema from "@oligarchy/db/schema";
import * as Tests from "@oligarchy/db/tests";

// A job is a test result and its Linear ticket; an action is one of its automation_jobs rows.
export type Job = typeof DbSchema.testResults.$inferSelect;

// A driver's last act is ./ctrl test-results. Until then its job is pending or running.
export const isOpen = (job: Job): boolean => job.status === "pending" || job.status === "running";

// The job behind a ticket, or none: linear_id is unique, one job per ticket.
export const byTicket = Effect.fn("Find.byTicket")(function* (ticket: string) {
  const tests = yield* Tests.TestStore;
  return yield* tests.findResultByLinearId(ticket);
});

// The next action to dispatch, in queue order, whose job has no action running; the skipped ids
// are the ones this tick already could not place.
export const nextPending = Effect.fn("Find.nextPending")(function* (skip: ReadonlyArray<string>) {
  const automation = yield* Automation.AutomationStore;
  return yield* automation.nextPending(skip);
});

export const status = Effect.fn("Find.status")(function* (
  job: Job,
  action: Automation.AutomationAction,
) {
  const automation = yield* Automation.AutomationStore;
  return yield* automation.jobStatus(job.id, action);
});

export const hasPending = Effect.fn("Find.hasPending")(function* (
  job: Job,
  action: Automation.AutomationAction,
) {
  const automation = yield* Automation.AutomationStore;
  return yield* automation.hasPending(job.id, action);
});

// The one action of a job in flight: a job runs one action at a time.
export const running = Effect.fn("Find.running")(function* (job: Job) {
  const automation = yield* Automation.AutomationStore;
  return yield* automation.findRunning(job.id);
});

// Every action running when this process starts, oldest first. None of them is this process's:
// they are the previous automation server's.
export const inherited = Effect.fn("Find.inherited")(function* () {
  const automation = yield* Automation.AutomationStore;
  return yield* automation.listRunning();
});

export type Diagnosable =
  | { readonly _tag: "ready" }
  | { readonly _tag: "held" }
  | { readonly _tag: "never"; readonly reason: string };

// A diagnose judges a drive or mint that ran to its end, so only a completed one is diagnosed.
// One still pending or running holds the diagnose; one that ended any other way, or none at all,
// means it never will be.
export const diagnosable = Effect.fn("Find.diagnosable")(function* (job: Job) {
  const drive = yield* status(job, "drive");
  const [action, ran] = Option.isSome(drive)
    ? ["drive", drive.value]
    : ["mint", Option.getOrUndefined(yield* status(job, "mint"))];
  if (ran === "completed") {
    const ready: Diagnosable = { _tag: "ready" };
    return ready;
  }
  if (ran === "pending" || ran === "running") {
    const held: Diagnosable = { _tag: "held" };
    return held;
  }
  const never: Diagnosable = {
    _tag: "never",
    reason: `not diagnosed; ${ran === undefined ? "no drive" : `${action} ${ran}`}`,
  };
  return never;
});
