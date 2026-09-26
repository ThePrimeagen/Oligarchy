import * as jarl from "jarl";
import * as Clock from "./clock.ts";
import * as Errors from "./errors.ts";

// A caller's fields. name, closed and now belong to the lifetime, not the data.
export type Data = { readonly [key: string]: unknown } & {
  readonly name?: never;
  readonly closed?: never;
  readonly now?: never;
};

export type Service = {
  readonly name: string;
  readonly closed: boolean;
  readonly now: () => number;
};

type Cleanup = () => Promise<jarl.Result<void, unknown>>;

type Waiter = (error: Errors.Closed) => void;

type State = {
  closed: boolean;
  clock: Clock.Clock;
  cleanups: Array<Cleanup>;
  children: Array<Service>;
  waiters: Set<Waiter>;
  closeResult: Promise<jarl.Result<void, Errors.CleanupFailed>> | undefined;
};

const states = new WeakMap<Service, State>();

const stateOf = (service: Service): State => {
  const state = states.get(service);
  if (state === undefined) {
    throw new Error(`${service.name} was not opened by async`);
  }
  return state;
};

export const clockOf = (service: Service): Clock.Clock => stateOf(service).clock;

// Sleep and latch register here. Close wakes them; it does not abort a function
// that is already running. The returned function drops the waiter, so a sleep
// that already finished does not stay registered until the service closes.
export const whenClosed = (service: Service, wake: Waiter): (() => void) => {
  const state = stateOf(service);
  if (state.closed) {
    wake(new Errors.Closed(service.name));
    return () => undefined;
  }
  state.waiters.add(wake);
  return () => {
    state.waiters.delete(wake);
  };
};

export const open = <T extends Data>(options: {
  readonly name: string;
  readonly data: T;
  readonly clock?: Clock.Clock;
  readonly parent?: Service;
}): Service & T => {
  const state: State = {
    closed: false,
    clock: options.clock ?? Clock.system(),
    cleanups: [],
    children: [],
    waiters: new Set(),
    closeResult: undefined,
  };
  const service: Service & T = {
    ...options.data,
    name: options.name,
    now: () => state.clock.now(),
    get closed() {
      return state.closed;
    },
  };
  states.set(service, state);
  const parent = options.parent;
  if (parent !== undefined) {
    const parentState = stateOf(parent);
    // A child cannot outlive a parent that has already ended.
    if (parentState.closed) {
      state.closed = true;
      state.closeResult = Promise.resolve(jarl.ok(undefined));
    } else {
      parentState.children.push(service);
    }
  }
  return service;
};

export const cleanup = (service: Service, run: Cleanup): jarl.Result<void, Errors.Closed> => {
  const state = stateOf(service);
  if (state.closed) {
    return jarl.err(new Errors.Closed(service.name));
  }
  state.cleanups.push(run);
  return jarl.ok(undefined);
};

const finish = async (
  service: Service,
  state: State,
): Promise<jarl.Result<void, Errors.CleanupFailed>> => {
  const causes: Array<unknown> = [];
  // Newest child first, then newest cleanup, so a parent releases what it opened last.
  for (const child of [...state.children].reverse()) {
    const result = await close(child);
    if (!result.ok) {
      causes.push(result.error);
    }
  }
  for (const run of [...state.cleanups].reverse()) {
    try {
      const result = await run();
      if (!result.ok) {
        causes.push(result.error);
      }
    } catch (caught) {
      causes.push(new Errors.Defect(caught));
    }
  }
  if (causes.length === 0) {
    return jarl.ok(undefined);
  }
  return jarl.err(new Errors.CleanupFailed(service.name, causes));
};

// Marks the service closed, wakes anyone waiting on it, then releases children
// and cleanups. A second call returns the same result and does not release again.
export const close = (service: Service): Promise<jarl.Result<void, Errors.CleanupFailed>> => {
  const state = stateOf(service);
  if (state.closeResult !== undefined) {
    return state.closeResult;
  }
  // Record the result before waking anyone. A cleanup or a waiter that calls
  // close again has to see this promise, or finish would run twice.
  const box: { settle: (value: jarl.Result<void, Errors.CleanupFailed>) => void } = {
    settle: () => undefined,
  };
  const result = new Promise<jarl.Result<void, Errors.CleanupFailed>>((resolve) => {
    box.settle = resolve;
  });
  state.closeResult = result;
  state.closed = true;
  const closed = new Errors.Closed(service.name);
  for (const wake of state.waiters) {
    wake(closed);
  }
  state.waiters.clear();
  void finish(service, state).then(box.settle, (caught: unknown) => {
    box.settle(jarl.err(new Errors.CleanupFailed(service.name, [new Errors.Defect(caught)])));
  });
  return result;
};

// Already closed: Closed, and run is not called. A run that has started is left
// to finish; close does not cut it off.
export const attempt = async <T, E>(
  service: Service,
  run: () => Promise<jarl.Result<T, E>>,
): Promise<jarl.Result<T, E | Errors.Closed | Errors.Defect>> => {
  if (service.closed) {
    return jarl.err(new Errors.Closed(service.name));
  }
  try {
    return await run();
  } catch (caught) {
    return jarl.err(new Errors.Defect(caught));
  }
};

// The check before using a dependency. The first closed one is the error, and
// this does not close the caller: the caller decides that.
export const requireOpen = (
  ...services: ReadonlyArray<Service>
): jarl.Result<void, Errors.Closed> => {
  for (const service of services) {
    if (service.closed) {
      return jarl.err(new Errors.Closed(service.name));
    }
  }
  return jarl.ok(undefined);
};
