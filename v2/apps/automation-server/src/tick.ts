import * as jarl from "jarl";

export const TickStopped = jarl.error.define("TickStopped");
export type TickStopped = InstanceType<typeof TickStopped>;

export const TickFailed = jarl.error.define("TickFailed");
export type TickFailed = InstanceType<typeof TickFailed>;

export type Ticking = {
  readonly stop: () => void;
  // Settles only once the loop has ended and the call in flight, if any, has returned.
  readonly done: Promise<jarl.Result<void, TickStopped | TickFailed>>;
};

const messageOf = (caught: unknown): string =>
  caught instanceof Error ? caught.message : String(caught);

// Calls fn every interval milliseconds, each interval counted from when the last call ended, while
// it is alive. A kill (signal aborting) ends it with ok; stop ends it with TickStopped and fn
// throwing with TickFailed. A kill or stop during the sleep ends it without waiting the interval out.
export const tick = (fn: () => unknown, interval: number, signal: AbortSignal): Ticking => {
  let alive = true;
  let stopped = false;
  let wake = (): void => undefined;

  const end = () => {
    alive = false;
    wake();
  };

  const sleep = () =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, interval);
      wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });

  const loop = async (): Promise<jarl.Result<void, TickStopped | TickFailed>> => {
    // A kill or stop clears alive through end, while the loop awaits.
    // oxlint-disable-next-line eslint/no-unmodified-loop-condition
    while (alive) {
      await sleep();
      if (!alive) {
        break;
      }
      try {
        await fn();
      } catch (caught) {
        return jarl.err(new TickFailed(`tick failed: ${messageOf(caught)}`));
      }
    }
    return stopped ? jarl.err(new TickStopped("tick stopped")) : jarl.ok(undefined);
  };

  if (signal.aborted) {
    alive = false;
  } else {
    signal.addEventListener("abort", end, { once: true });
  }
  const done = loop().finally(() => {
    alive = false;
    signal.removeEventListener("abort", end);
  });

  return {
    stop: () => {
      if (alive) {
        stopped = true;
        end();
      }
    },
    done,
  };
};
