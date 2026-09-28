import type * as App from "@oligarchy/app";
import * as Abort from "./abort.ts";
import * as Board from "./board.ts";
import * as Close from "./close.ts";
import * as Find from "./find.ts";
import type { Needs } from "./needs.ts";
import * as Open from "./open.ts";
import * as Reclaim from "./reclaim.ts";

// A function of jobs with its needs already given.
type Bound<F> = F extends (needs: never, ...args: infer A) => infer R ? (...args: A) => R : never;

export type Jobs = {
  readonly service: "jobs";
  readonly open: Bound<typeof Open.open>;
  readonly openMint: Bound<typeof Open.openMint>;
  readonly openMints: Bound<typeof Open.openMints>;
  readonly mintDefinition: Bound<typeof Open.mintDefinition>;
  readonly actionFor: Bound<typeof Board.actionFor>;
  readonly driveOrMint: Bound<typeof Board.driveOrMint>;
  readonly enqueue: Bound<typeof Board.enqueue>;
  readonly queue: Bound<typeof Board.queue>;
  readonly diagnosable: Bound<typeof Find.diagnosable>;
  readonly judge: Bound<typeof Close.judge>;
  readonly close: Bound<typeof Close.close>;
  readonly fail: Bound<typeof Close.fail>;
  readonly abort: Bound<typeof Abort.abort>;
  readonly abortRunning: Bound<typeof Abort.running>;
  readonly reclaim: Bound<typeof Reclaim.reclaim>;
};

declare module "@oligarchy/app" {
  interface Services {
    jobs: App.Register<"jobs", Jobs>;
  }
}

export const create = (needs: Needs): Jobs => ({
  service: "jobs",
  open: (input) => Open.open(needs, input),
  openMint: (input) => Open.openMint(needs, input),
  openMints: (input) => Open.openMints(needs, input),
  mintDefinition: () => Open.mintDefinition(needs),
  actionFor: (column, job) => Board.actionFor(needs, column, job),
  driveOrMint: (job) => Board.driveOrMint(needs, job),
  enqueue: (job, action) => Board.enqueue(needs, job, action),
  queue: (ticket, column) => Board.queue(needs, ticket, column),
  diagnosable: (job) => Find.diagnosable(needs, job),
  judge: (action) => Close.judge(needs, action),
  close: (action, outcome) => Close.close(needs, action, outcome),
  fail: (action, ticket, reason) => Close.fail(needs, action, ticket, reason),
  abort: (ticket, action) => Abort.abort(needs, ticket, action),
  abortRunning: (ticket, action) => Abort.running(needs, ticket, action),
  reclaim: (action, stop) => Reclaim.reclaim(needs, action, stop),
});
