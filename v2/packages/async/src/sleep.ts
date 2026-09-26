import * as jarl from "jarl";
import * as Errors from "./errors.ts";
import * as Service from "./service.ts";

type Watch = {
  readonly done: Promise<jarl.Result<void, Errors.Closed>>;
  // Drops the timer without settling. timeout calls it when the run wins, so
  // the deadline does not keep the process alive.
  readonly stop: () => void;
};

// Waits on the service's clock. Close resolves it with Closed; the wait is not
// left running, and a later tick of the clock cannot turn that into success.
const watch = (service: Service.Service, ms: number): Watch => {
  if (service.closed) {
    return {
      done: Promise.resolve(jarl.err(new Errors.Closed(service.name))),
      stop: () => undefined,
    };
  }
  if (ms <= 0) {
    return { done: Promise.resolve(jarl.ok(undefined)), stop: () => undefined };
  }
  const delay = Service.clockOf(service).delay(ms);
  let forget = (): void => undefined;
  let settled = false;
  const done = new Promise<jarl.Result<void, Errors.Closed>>((resolve) => {
    const finish = (result: jarl.Result<void, Errors.Closed>) => {
      if (settled) {
        return;
      }
      settled = true;
      forget();
      resolve(result);
    };
    forget = Service.whenClosed(service, (error) => {
      delay.stop();
      finish(jarl.err(error));
    });
    void delay.done.then(() => {
      if (service.closed) {
        finish(jarl.err(new Errors.Closed(service.name)));
        return;
      }
      finish(jarl.ok(undefined));
    });
  });
  return {
    done,
    stop() {
      if (settled) {
        return;
      }
      delay.stop();
      forget();
    },
  };
};

export const sleep = (
  service: Service.Service,
  ms: number,
): Promise<jarl.Result<void, Errors.Closed>> => watch(service, ms).done;

export { watch };
