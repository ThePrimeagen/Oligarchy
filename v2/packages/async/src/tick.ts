import * as jarl from "jarl";
import * as Errors from "./errors.ts";
import * as Service from "./service.ts";
import * as Sleep from "./sleep.ts";

// The loop runs until the service closes or a run fails. immediate starts the
// first run now, which is what a heartbeat does; a sampler that should wait
// passes immediate: false. A run that has started is allowed to finish after
// close, and the loop then returns Closed instead of scheduling another one.
export const tick = async <E>(
  service: Service.Service,
  every: number,
  run: () => Promise<jarl.Result<void, E>>,
  options?: { readonly immediate?: boolean },
): Promise<jarl.Result<void, E | Errors.Closed | Errors.Defect>> => {
  const immediate = options?.immediate ?? true;
  if (!immediate) {
    const waited = await Sleep.sleep(service, every);
    if (!waited.ok) {
      return waited;
    }
  }
  for (;;) {
    if (service.closed) {
      return jarl.err(new Errors.Closed(service.name));
    }
    let result: jarl.Result<void, E>;
    try {
      result = await run();
    } catch (caught) {
      return jarl.err(new Errors.Defect(caught));
    }
    // Close during the run wins over the run's own error: the service is gone,
    // which is what the owner has to act on.
    if (service.closed) {
      return jarl.err(new Errors.Closed(service.name));
    }
    if (!result.ok) {
      return result;
    }
    const waited = await Sleep.sleep(service, every);
    if (!waited.ok) {
      return waited;
    }
  }
};
