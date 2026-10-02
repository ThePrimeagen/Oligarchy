import * as App from "@oligarchy/app";
import type * as Db from "@oligarchy/db";
import * as Stores from "@oligarchy/stores";
import * as jarl from "jarl";

// Everything recorded of one drive or setup, what the diagnosing agent judges it by. Every list
// is oldest first. logs are the job's turn of its test run's lines; images list each screenshot
// by the id getImage reads its PNG under. debugLog is null until the qemu server saved one,
// diagnosis until a reviewer wrote one.
export type Evidence = {
  readonly job: Stores.Tests.JobRow;
  readonly run: Stores.Tests.RunRow;
  readonly suite: Stores.Tests.SuiteRow | null;
  readonly definition: Stores.Tests.DefinitionRow;
  readonly vmStatus: ReadonlyArray<Stores.VmStatus.VmStatusRow>;
  readonly logs: ReadonlyArray<Stores.Logs.LogRow>;
  readonly actions: ReadonlyArray<Stores.Actions.ActionRow>;
  readonly images: ReadonlyArray<Stores.Actions.Image>;
  readonly debugLog: Stores.DebugLogs.DebugLogRow | null;
  readonly diagnosis: Stores.Diagnosis.DiagnosisRow | null;
};

export type Ctrl = {
  readonly service: "ctrl";
  readonly getEvidence: (
    jobId: string,
  ) => Promise<
    jarl.Result<Evidence, Db.DatabaseError | Stores.Tests.NotFound | Stores.Tests.InvalidState>
  >;
  readonly getImage: (imageId: string) => Stores.Tests.Found<Uint8Array>;
};

declare module "@oligarchy/app" {
  interface Services {
    ctrl: App.Register<"ctrl", Ctrl>;
  }
}

export const create = App.createService<
  | Stores.Tests.Tests
  | Stores.Actions.Actions
  | Stores.Logs.Logs
  | Stores.DebugLogs.DebugLogs
  | Stores.VmStatus.VmStatus
  | Stores.Diagnosis.Diagnosis,
  App.NoOptions,
  Ctrl
>((services) => ({
  service: "ctrl",

  getEvidence: async (jobId) => {
    const found = await services.tests.getJobDetails(jobId);
    if (jarl.error.is(found, Stores.Tests.NotFound)) {
      return jarl.err(new Stores.Tests.NotFound(`getEvidence: no job ${jobId}`));
    }
    if (jarl.is_err(found)) {
      return found;
    }
    const { job, run, suite, definition } = jarl.value(found);
    // A diagnose job's own guest is none: it reads the drive or setup before it.
    if (job.action === "diagnose") {
      return jarl.err(
        new Stores.Tests.InvalidState(
          `getEvidence: job ${jobId} is a diagnose; evidence is of the drive or setup it judges`,
        ),
      );
    }
    const [vmStatus, logs, actions, images, debugLog, diagnosis] = await Promise.all([
      services.vmStatus.history(jobId),
      services.logs.listJobLogs(jobId),
      services.actions.listActions(jobId),
      services.actions.listImages(jobId),
      services.debugLogs.getDebugLog(jobId),
      services.diagnosis.getDiagnosis(jobId),
    ]);
    if (jarl.is_err(vmStatus)) {
      return vmStatus;
    }
    if (jarl.is_err(logs)) {
      return logs;
    }
    if (jarl.is_err(actions)) {
      return actions;
    }
    if (jarl.is_err(images)) {
      return images;
    }
    if (jarl.is_err(debugLog)) {
      return debugLog;
    }
    if (jarl.is_err(diagnosis)) {
      return diagnosis;
    }
    return jarl.ok({
      job,
      run,
      suite,
      definition,
      vmStatus: jarl.value(vmStatus),
      logs: jarl.value(logs),
      actions: jarl.value(actions),
      images: jarl.value(images),
      debugLog: jarl.value(debugLog) ?? null,
      diagnosis: jarl.value(diagnosis) ?? null,
    });
  },

  getImage: async (imageId) => {
    const image = await services.actions.getImage(imageId);
    if (jarl.is_err(image)) {
      return image;
    }
    const data = jarl.value(image);
    return data === undefined
      ? jarl.err(new Stores.Tests.NotFound(`getImage: no image ${imageId}`))
      : jarl.ok(data);
  },
}));
