// What is open: every send and every ended span from the moment it is made until it settles. The
// count is the size of the set, so a settle can take away only what it added.
export type Count = {
  readonly open: () => number;
  // One more open. settle makes it one fewer, the first time only; settled resolves then.
  readonly add: () => { readonly settle: () => void; readonly settled: Promise<void> };
  // Resolves the next time nothing is open, and at once when nothing is.
  readonly idle: () => Promise<void>;
};

export const create = (): Count => {
  const open = new Set<() => void>();
  let idle: Array<() => void> = [];

  return {
    open: () => open.size,
    add: () => {
      let resolve: () => void = () => undefined;
      const settled = new Promise<void>((done) => {
        resolve = done;
      });
      const settle = () => {
        if (!open.delete(settle)) {
          return;
        }
        resolve();
        if (open.size === 0) {
          const woken = idle;
          idle = [];
          for (const wake of woken) {
            wake();
          }
        }
      };
      open.add(settle);
      return { settle, settled };
    },
    idle: () =>
      open.size === 0
        ? Promise.resolve()
        : new Promise((resolve) => {
            idle.push(resolve);
          }),
  };
};
