export type Delay = {
  readonly done: Promise<void>;
  readonly stop: () => void;
};

export type Clock = {
  readonly now: () => number;
  readonly delay: (ms: number) => Delay;
};

export type ManualClock = Clock & {
  readonly advance: (ms: number) => void;
};

type Waiter = {
  due: number;
  resolve: () => void;
  stopped: boolean;
};

// Tests drive this. Nothing resolves until advance says so.
export const manual = (start = 0): ManualClock => {
  let time = start;
  const waiters: Array<Waiter> = [];
  return {
    now: () => time,
    delay(ms: number): Delay {
      const box: { waiter?: Waiter } = {};
      const done = new Promise<void>((resolve) => {
        const waiter: Waiter = { due: time + ms, resolve, stopped: false };
        box.waiter = waiter;
        waiters.push(waiter);
      });
      return {
        done,
        stop() {
          const waiter = box.waiter;
          if (waiter !== undefined) {
            waiter.stopped = true;
          }
        },
      };
    },
    advance(ms: number) {
      time += ms;
      for (const waiter of waiters) {
        if (!waiter.stopped && waiter.due <= time) {
          waiter.stopped = true;
          waiter.resolve();
        }
      }
    },
  };
};

// The one real timer. Everything else waits on a service, which waits on a clock.
export const system = (): Clock => ({
  now: () => Date.now(),
  delay(ms: number): Delay {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const done = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, ms);
    });
    return {
      done,
      stop() {
        if (timer !== undefined) {
          clearTimeout(timer);
        }
      },
    };
  },
});
