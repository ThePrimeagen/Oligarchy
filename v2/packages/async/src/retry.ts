import * as jarl from "jarl";
import * as Errors from "./errors.ts";
import * as Service from "./service.ts";
import * as Sleep from "./sleep.ts";

// attempts is the total number of tries, including the first. Three attempts is
// what a ticket move gets today. Closed is never retried: the dependency is
// gone, and another try will not bring it back. A throw is a Defect, also not
// retried.
export const retry = async <T, E>(
  service: Service.Service,
  run: () => Promise<jarl.Result<T, E>>,
  options: {
    readonly attempts: number;
    readonly delay: number | ((failures: number) => number);
    readonly retryOn?: (error: E) => boolean;
  },
): Promise<jarl.Result<T, E | Errors.Closed | Errors.Defect>> => {
  let failures = 0;
  for (;;) {
    if (service.closed) {
      return jarl.err(new Errors.Closed(service.name));
    }
    let result: jarl.Result<T, E>;
    try {
      result = await run();
    } catch (caught) {
      return jarl.err(new Errors.Defect(caught));
    }
    if (result.ok) {
      return result;
    }
    if (result.error instanceof Errors.Closed) {
      return jarl.err(result.error);
    }
    failures += 1;
    if (failures >= options.attempts) {
      return result;
    }
    let delay: number;
    try {
      const retryOn = options.retryOn;
      if (retryOn !== undefined && !retryOn(result.error)) {
        return result;
      }
      delay = typeof options.delay === "number" ? options.delay : options.delay(failures);
    } catch (caught) {
      return jarl.err(new Errors.Defect(caught));
    }
    const waited = await Sleep.sleep(service, delay);
    if (!waited.ok) {
      return waited;
    }
  }
};
