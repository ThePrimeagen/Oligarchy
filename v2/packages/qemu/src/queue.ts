import * as jarl from "jarl";
import * as Async from "@oligarchy/async";
import { type Failure, type Answer, QemuFailed } from "./errors.ts";

// One producer and one reader. Bounded, including when the reader disappears.
export const create = <T>(limit: number) => {
  const values: T[] = [];
  let end: Failure | true | undefined;
  let waiting: ((answer: jarl.Result<T | undefined, Failure>) => void) | undefined;
  const finish = (reason: Failure | true = true) => {
    if (end !== undefined) return;
    end = reason;
    if (waiting !== undefined) {
      waiting(reason === true ? jarl.ok(undefined) : jarl.err(reason));
      waiting = undefined;
    }
  };
  return {
    push: (value: T) => {
      if (end !== undefined) return false;
      if (waiting !== undefined) {
        const resolve = waiting;
        waiting = undefined;
        resolve(jarl.ok(value));
        return true;
      }
      if (values.length >= limit) {
        finish(new QemuFailed("reader fell behind"));
        return false;
      }
      values.push(value);
      return true;
    },
    finish,
    read: (signal: AbortSignal): Answer<T | undefined> => {
      if (signal.aborted) return Promise.resolve(jarl.err(new Async.Aborted("reader aborted")));
      if (end !== undefined && end !== true) return Promise.resolve(jarl.err(end));
      const value = values.shift();
      if (value !== undefined) return Promise.resolve(jarl.ok(value));
      if (end === true) return Promise.resolve(jarl.ok(undefined));
      if (waiting !== undefined)
        return Promise.resolve(jarl.err(new QemuFailed("concurrent read")));
      return new Promise((resolve) => {
        const abort = () => {
          waiting = undefined;
          resolve(jarl.err(new Async.Aborted("reader aborted")));
        };
        signal.addEventListener("abort", abort, { once: true });
        waiting = (answer) => {
          signal.removeEventListener("abort", abort);
          resolve(answer);
        };
      });
    },
  };
};
