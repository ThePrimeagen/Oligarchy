import { Aborted } from "@oligarchy/async";
import * as jarl from "jarl";
import type * as Routes from "./routes.ts";

export const AlreadyHeld = jarl.error.define("AlreadyHeld");
export type AlreadyHeld = InstanceType<typeof AlreadyHeld>;

export const ShuttingDown = jarl.error.define("ShuttingDown");
export type ShuttingDown = InstanceType<typeof ShuttingDown>;

// What a reservation, and then its run, holds a job by. The signal aborts when the job is aborted
// or the client shuts down: the run kills its driver or opencode on it, and a reservation gives its
// guest back. release lets the job go once that is done. Nothing here touches the job's row: its
// status is the automation server's to write.
export type Held = {
  readonly signal: AbortSignal;
  readonly release: () => void;
};

export type Jobs = {
  readonly hold: (jobId: string) => jarl.Result<Held, AlreadyHeld | ShuttingDown>;
  // The jobs held until their holder lets them go: each reserved or running against --max-jobs.
  readonly count: () => number;
  // Aborts the job and settles once its holder has let it go.
  readonly abort: Routes.Sessions["abort"];
  // Aborts every job held and settles once each has been let go. From its start no job is held
  // again, so a reserve that lands meanwhile is refused instead of outliving the process.
  readonly shutdown: () => Promise<void>;
};

type Entry = {
  readonly aborter: AbortController;
  readonly released: Promise<void>;
  readonly release: () => void;
};

// Held only in memory: a restarted client holds nothing, and the automation server decides what
// becomes of the jobs it had.
export const create = (): Jobs => {
  const held = new Map<string, Entry>();
  let shuttingDown = false;

  const stop = (entry: Entry, reason: Aborted): Promise<void> => {
    entry.aborter.abort(reason);
    return entry.released;
  };

  return {
    hold: (jobId) => {
      if (shuttingDown) {
        return jarl.err(new ShuttingDown(`shutting down; job ${jobId} not held`));
      }
      if (held.has(jobId)) {
        return jarl.err(new AlreadyHeld(`job ${jobId} is already held`));
      }
      const aborter = new AbortController();
      let resolve = () => {};
      const released = new Promise<void>((settle) => {
        resolve = settle;
      });
      const entry: Entry = {
        aborter,
        released,
        release: () => {
          if (held.get(jobId) === entry) {
            held.delete(jobId);
          }
          resolve();
        },
      };
      held.set(jobId, entry);
      return jarl.ok({ signal: aborter.signal, release: entry.release });
    },
    count: () => held.size,
    abort: async ({ jobId }) => {
      const entry = held.get(jobId);
      if (entry === undefined) {
        return "not-held";
      }
      await stop(entry, new Aborted(`job ${jobId} aborted`));
      return "stopped";
    },
    shutdown: async () => {
      shuttingDown = true;
      await Promise.all(
        [...held.values()].map((entry) => stop(entry, new Aborted("shutting down"))),
      );
    },
  };
};
