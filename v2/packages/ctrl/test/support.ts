import * as App from "@oligarchy/app";
import type * as Stores from "@oligarchy/stores";
import * as jarl from "jarl";
import * as Ctrl from "../src/main.ts";

export const JOB = "00000000-0000-4000-8000-000000000001";

const unused = (): never => {
  throw new Error("unexpected call");
};

// A frame as the logs store hands it back; only its number differs.
export const frame = (number: number): Stores.Logs.Frame => ({
  frame: number,
  frames: 3,
  screenshot: null,
  openIntent: null,
  moves: [],
  actions: [],
  logs: [],
  vmStatus: [],
});

export const DEBUG_LOG: Stores.Logs.DebugLogRow = {
  jobId: JOB,
  sources: { serial: "omarchy login:", proxy: "", qemu: "", actions: "" },
  createdAt: new Date(0),
};

// Every read ctrl asked of the logs store, in order, as [name, ...arguments].
export type Asked = readonly [string, ...ReadonlyArray<unknown>];

// ctrl for JOB over a logs store that answers what `script` says: each frame asked for, and
// DEBUG_LOG, unless told otherwise.
export const world = (
  script: {
    readonly getFrame?: Stores.Logs.Logs["getFrame"];
    readonly getDebugLog?: Stores.Logs.Logs["getDebugLog"];
  } = {},
) => {
  const asked: Array<Asked> = [];
  const logs = App.createService<never, App.NoOptions, Stores.Logs.Logs>(() => ({
    service: "logs",
    insertLog: unused,
    listLogs: unused,
    listRecent: unused,
    listIntents: unused,
    getFrame: async (jobId, number) => {
      asked.push(["getFrame", jobId, number]);
      return script.getFrame === undefined
        ? jarl.ok(frame(number))
        : script.getFrame(jobId, number);
    },
    getDebugLog: async (jobId) => {
      asked.push(["getDebugLog", jobId]);
      return script.getDebugLog === undefined ? jarl.ok(DEBUG_LOG) : script.getDebugLog(jobId);
    },
  }))({});
  return { asked, ctrl: Ctrl.create({ logs }, { jobId: JOB }) };
};
