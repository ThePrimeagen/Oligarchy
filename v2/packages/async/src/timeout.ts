import * as jarl from "jarl";
import * as Errors from "./errors.ts";
import * as Service from "./service.ts";
import * as Sleep from "./sleep.ts";

// Whichever finishes first is the result. The run is not stopped when the
// deadline or a close wins: there is no interrupt. A run that must stop has to
// wait on the service itself.
export const timeout = <T, E>(
  service: Service.Service,
  after: number,
  run: () => Promise<jarl.Result<T, E>>,
): Promise<jarl.Result<T, E | Errors.TimedOut | Errors.Closed | Errors.Defect>> => {
  if (service.closed) {
    return Promise.resolve(jarl.err(new Errors.Closed(service.name)));
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (
      result: jarl.Result<T, E | Errors.TimedOut | Errors.Closed | Errors.Defect>,
    ) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(result);
    };
    const waiting = Sleep.watch(service, after);
    void waiting.done.then((waited) => {
      if (!waited.ok) {
        finish(waited);
        return;
      }
      finish(jarl.err(new Errors.TimedOut(service.name, after)));
    });
    try {
      const pending = run();
      void pending.then(
        (result) => {
          waiting.stop();
          finish(result);
        },
        (caught: unknown) => {
          waiting.stop();
          finish(jarl.err(new Errors.Defect(caught)));
        },
      );
    } catch (caught) {
      waiting.stop();
      finish(jarl.err(new Errors.Defect(caught)));
    }
  });
};
