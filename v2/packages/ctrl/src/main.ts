import * as App from "@oligarchy/app";
import type * as Db from "@oligarchy/db";
import type * as Stores from "@oligarchy/stores";
import * as jarl from "jarl";

export type Options = {
  // The drive or setup the diagnosing agent judges.
  readonly jobId: string;
};

// The diagnosing agent's tools over one job. moreData walks back one screenshot per call, newest
// first: each frame is a screenshot and every move, action, log line and VM change from it until
// the next. A frame the store could not give is not passed: the next call asks for it again.
// debugLogs is the serial console, journal and the rest the qemu server saved.
export type Ctrl = {
  readonly service: "ctrl";
  readonly moreData: () => Promise<
    jarl.Result<Stores.Logs.Frame, Db.DatabaseError | Stores.Tests.NotFound | Stores.Logs.NoFrame>
  >;
  readonly debugLogs: () => Stores.Tests.Found<Stores.Logs.DebugLogRow>;
};

declare module "@oligarchy/app" {
  interface Services {
    ctrl: App.Register<"ctrl", Ctrl>;
  }
}

export const create = App.createService<Stores.Logs.Logs, Options, Ctrl>(({ logs }, { jobId }) => {
  let frame = 0;
  return {
    service: "ctrl",

    moreData: async () => {
      const got = await logs.getFrame(jobId, frame);
      if (jarl.is_ok(got)) {
        frame += 1;
      }
      return got;
    },

    debugLogs: () => logs.getDebugLog(jobId),
  };
});
