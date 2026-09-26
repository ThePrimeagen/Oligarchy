import * as jarl from "jarl";
import * as Errors from "./errors.ts";
import * as Service from "./service.ts";

// One value, once. Waiters blocked on it receive Closed when the service
// closes before it is settled. A value that was already set stays readable.
class Latch<T, E> {
  readonly service: Service.Service;
  #waiters: Array<(result: jarl.Result<T, E | Errors.Closed>) => void> = [];
  #result: jarl.Result<T, E> | undefined;

  constructor(service: Service.Service) {
    this.service = service;
  }

  succeed(value: T): jarl.Result<void, Errors.Closed | Errors.AlreadySettled> {
    return this.#settle(jarl.ok(value));
  }

  fail(error: E): jarl.Result<void, Errors.Closed | Errors.AlreadySettled> {
    return this.#settle(jarl.err(error));
  }

  wait(): Promise<jarl.Result<T, E | Errors.Closed>> {
    const result = this.#result;
    if (result !== undefined) {
      return Promise.resolve(result);
    }
    if (this.service.closed) {
      return Promise.resolve(jarl.err(new Errors.Closed(this.service.name)));
    }
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value: jarl.Result<T, E | Errors.Closed>) => {
        if (settled) {
          return;
        }
        settled = true;
        resolve(value);
      };
      const forget = Service.whenClosed(this.service, (error) => {
        finish(jarl.err(error));
      });
      this.#waiters.push((value) => {
        forget();
        finish(value);
      });
    });
  }

  #settle(result: jarl.Result<T, E>): jarl.Result<void, Errors.Closed | Errors.AlreadySettled> {
    // Closed wins over AlreadySettled: the service is gone, which is the fact
    // the caller has to act on.
    if (this.service.closed) {
      return jarl.err(new Errors.Closed(this.service.name));
    }
    if (this.#result !== undefined) {
      return jarl.err(new Errors.AlreadySettled(this.service.name));
    }
    this.#result = result;
    const waiters = this.#waiters;
    this.#waiters = [];
    for (const waiter of waiters) {
      waiter(result);
    }
    return jarl.ok(undefined);
  }
}

export type { Latch };

export const latch = <T, E>(service: Service.Service): Latch<T, E> => new Latch(service);

export const succeed = <T, E>(
  held: Latch<T, E>,
  value: T,
): jarl.Result<void, Errors.Closed | Errors.AlreadySettled> => held.succeed(value);

export const fail = <T, E>(
  held: Latch<T, E>,
  error: E,
): jarl.Result<void, Errors.Closed | Errors.AlreadySettled> => held.fail(error);

export const wait = <T, E>(held: Latch<T, E>): Promise<jarl.Result<T, E | Errors.Closed>> =>
  held.wait();
