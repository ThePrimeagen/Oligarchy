import * as Clock from "./clock.ts";

// A service is a data object with a lifetime. jarl is the result; this package is
// the waiting, the retry, the tick and the close. There is no interrupt: close
// wakes whoever is waiting and they get Closed.

export { AlreadySettled, CleanupFailed, Closed, Defect, TimedOut } from "./errors.ts";

export type { Clock, ManualClock } from "./clock.ts";

export const clock = {
  manual: Clock.manual,
  system: Clock.system,
};

export type { Data, Service } from "./service.ts";
export { attempt, cleanup, close, open, requireOpen } from "./service.ts";

export { sleep } from "./sleep.ts";
export { retry } from "./retry.ts";
export { tick } from "./tick.ts";
export { timeout } from "./timeout.ts";
export type { Latch } from "./latch.ts";
export { fail, latch, succeed, wait } from "./latch.ts";
