import type * as App from "@oligarchy/app";
import type * as Stores from "@oligarchy/stores";
import * as jarl from "jarl";

// Shared by dispatch and the driver. The job's pinned definition and test run are the mission;
// neither a caller's prompt nor a suite supplies the ISO, instructions or boot mode.
export type Mission = {
  readonly jobId: string;
  readonly runId: string;
  readonly action: Stores.Tests.JobAction;
  readonly name: string;
  readonly description: string;
  readonly instruction: string;
  readonly proof: string;
  readonly iso: string;
  readonly serverUrl: string;
  readonly resume: boolean;
};

export const load = async (
  services: App.Needs<Stores.Tests.Tests>,
  options: { readonly jobId: string },
) => {
  const found = await services.tests.getJobDetails(options.jobId);
  if (jarl.is_err(found)) {
    return found;
  }
  const { job, run, definition } = jarl.value(found);
  return jarl.ok({
    jobId: job.id,
    runId: run.id,
    action: job.action,
    name: definition.name,
    description: definition.description,
    instruction: definition.instruction,
    proof: definition.proof,
    iso: run.iso,
    serverUrl: run.serverUrl,
    resume: job.action === "drive" && definition.resume,
  } satisfies Mission);
};
