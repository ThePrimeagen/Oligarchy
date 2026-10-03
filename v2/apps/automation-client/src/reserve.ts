import type * as App from "@oligarchy/app";
import * as Http from "@oligarchy/http";
import type * as Logger from "@oligarchy/logger";
import * as jarl from "jarl";
import type * as Jobs from "./jobs.ts";
import type * as Proxy from "./proxy.ts";
import * as Routes from "./routes.ts";

const LOCATION = "automation-client";

// What a run takes from its job's reservation: what the job was reserved as, and its hold.
export type Taken = Omit<Jobs.Held, "release"> & {
  readonly release: () => void | Promise<void>;
  readonly action: Routes.ReserveRequest["action"];
};

export type Reservations = {
  readonly reserve: Routes.Sessions["reserve"];
  // Hands the job's reservation to its run: from then on the run answers the job's abort and calls
  // release, and nothing is given back for it here. Undefined when the job has no reservation, or
  // a run already took it.
  readonly take: (jobId: string) => Taken | undefined;
};

type Reservation = Taken & {
  readonly onAbort: () => void;
  readonly expiry: ReturnType<typeof setTimeout>;
};

export type Options = {
  readonly maxJobs: number;
  readonly reservationTimeoutMs: number;
  readonly jobs: Jobs.Jobs;
  readonly proxy: Proxy.Proxy;
};

// A reserve holds its job against maxJobs, and a drive or setup a guest at the proxy first. One
// reserve asks the proxy at a time; another meanwhile is AtCapacity, and the automation server
// asks again. A reservation lives in memory only, so a restarted client holds nothing.
export const create = (services: App.Needs<Logger.Logger>, options: Options): Reservations => {
  const { maxJobs, jobs, proxy } = options;
  const { logger } = services;
  const reservations = new Map<string, Reservation>();
  let reserving = false;

  // A guest the proxy will not take back is a line; the job is let go all the same.
  const giveBack = async (jobId: string): Promise<void> => {
    const relinquished = await proxy.relinquish(jobId);
    if (jarl.is_err(relinquished)) {
      logger.error(`relinquish failed: ${relinquished.error.message}`, {
        location: LOCATION,
        jobId,
        cause: relinquished.error,
      });
    }
  };

  const letGo = async (taken: Taken, jobId: string): Promise<void> => {
    if (taken.action !== "diagnose") {
      await giveBack(jobId);
    }
    await taken.release();
  };

  // Until a run takes the job, its abort is answered here: a guest goes back to the proxy before
  // the job is let go.
  const keep = (jobId: string, action: Taken["action"], held: Jobs.Held): void => {
    const taken: Taken = { action, signal: held.signal, release: held.release };
    const onAbort = () => {
      clearTimeout(expiry);
      reservations.delete(jobId);
      jarl.forget(letGo, taken, jobId);
    };
    const expiry = setTimeout(() => {
      jarl.forget(jobs.abort, { jobId });
    }, options.reservationTimeoutMs);
    reservations.set(jobId, { ...taken, onAbort, expiry });
    if (held.signal.aborted) {
      onAbort();
      return;
    }
    held.signal.addEventListener("abort", onAbort, { once: true });
  };

  const reserveGuest = async (
    request: Proxy.GuestRequest,
    held: Jobs.Held,
  ): ReturnType<Routes.Sessions["reserve"]> => {
    const asked = await proxy.reserve(request, held.signal);
    if (jarl.error.is(asked, Routes.AtCapacity) || jarl.error.is(asked, Routes.SetupNeeded)) {
      held.release();
      return asked;
    }
    if (jarl.is_err(asked)) {
      // A 4xx reserved nothing. Any other failure, an abort or a timeout among them, may have
      // reserved the guest before its answer was lost.
      const refused =
        jarl.error.is(asked, Http.HttpBadRequest) ||
        jarl.error.is(asked, Http.HttpNotFound) ||
        jarl.error.is(asked, Http.HttpUnhandled);
      if (!refused) {
        await giveBack(request.jobId);
      }
      held.release();
      return jarl.err(new Routes.ReserveFailed(`reserving a guest failed: ${asked.error.message}`));
    }
    keep(request.jobId, request.action, held);
    return jarl.ok(undefined);
  };

  return {
    reserve: async (request) => {
      if (reserving) {
        return jarl.err(new Routes.AtCapacity("at capacity: a reserve is already in flight"));
      }
      if (jobs.count() >= maxJobs) {
        return jarl.err(new Routes.AtCapacity(`at capacity: max-jobs is ${String(maxJobs)}`));
      }
      const held = jobs.hold(request.jobId);
      if (jarl.is_err(held)) {
        return held;
      }
      if (request.action === "diagnose") {
        keep(request.jobId, request.action, jarl.value(held));
        return jarl.ok(undefined);
      }
      reserving = true;
      try {
        return await reserveGuest(request, jarl.value(held));
      } finally {
        reserving = false;
      }
    },
    take: (jobId) => {
      const reservation = reservations.get(jobId);
      if (reservation === undefined) {
        return undefined;
      }
      clearTimeout(reservation.expiry);
      reservations.delete(jobId);
      reservation.signal.removeEventListener("abort", reservation.onAbort);
      const { action, signal, release } = reservation;
      return {
        action,
        signal,
        release: async () => {
          try {
            if (action !== "diagnose") await giveBack(jobId);
          } finally {
            await release();
          }
        },
      };
    },
  };
};
