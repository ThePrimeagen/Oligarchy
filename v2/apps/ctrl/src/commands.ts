import type * as App from "@oligarchy/app";
import type * as Db from "@oligarchy/db";
import * as Stores from "@oligarchy/stores";
import * as jarl from "jarl";
import type { Flags, Run } from "./environment.ts";
import type { Services } from "./services.ts";

// What was asked cannot be done, and nothing was written. The message is the whole report.
export const Refused = jarl.error.define("Refused");
export type Refused = InstanceType<typeof Refused>;

// Where a command's text and files go: the process's own, or a test's. writeFile throws as the
// file system does.
export type Output = {
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  readonly writeFile: (path: string, data: Uint8Array) => Promise<void>;
};

type Done = Promise<jarl.Result<void, Refused | Db.DatabaseError>>;

const messageOf = (thrown: unknown): string =>
  thrown instanceof Error ? thrown.message : String(thrown);

export const logs = async (
  services: App.Needs<
    | Stores.Tests.Tests
    | Stores.VmStatus.VmStatus
    | Stores.Logs.Logs
    | Stores.Actions.Actions
    | Stores.DebugLogs.DebugLogs
    | Stores.Diagnosis.Diagnosis
  >,
  flags: Flags<"logs">,
  out: Output,
): Done => {
  const { jobId } = flags;
  const details = await services.tests.getJobDetails(jobId);
  if (jarl.error.is(details, Stores.Tests.NotFound)) {
    return jarl.err(new Refused(`logs: no job ${jobId}`));
  }
  if (jarl.is_err(details)) {
    return details;
  }
  const { job, run, suite, definition } = jarl.value(details);
  if (job.action === "diagnose") {
    return jarl.err(
      new Refused(`logs: job ${jobId} is a diagnose job; name the drive or setup it judges`),
    );
  }
  const vmStatus = await services.vmStatus.history(jobId);
  if (jarl.is_err(vmStatus)) {
    return vmStatus;
  }
  const intents = await services.logs.listIntents({ jobId });
  if (jarl.is_err(intents)) {
    return intents;
  }
  const actions = await services.actions.listActions(jobId);
  if (jarl.is_err(actions)) {
    return actions;
  }
  const images = await services.actions.listImages(jobId);
  if (jarl.is_err(images)) {
    return images;
  }
  const debugLog = await services.debugLogs.getDebugLog(jobId);
  if (jarl.is_err(debugLog)) {
    return debugLog;
  }
  const diagnosis = await services.diagnosis.getDiagnosis(jobId);
  if (jarl.is_err(diagnosis)) {
    return diagnosis;
  }
  const errorTypes = await services.diagnosis.listErrorTypes();
  if (jarl.is_err(errorTypes)) {
    return errorTypes;
  }
  const shown = {
    job,
    run,
    suite,
    definition,
    vmStatus: jarl.value(vmStatus),
    intents: jarl.value(intents),
    actions: jarl.value(actions),
    images: jarl.value(images),
    debugLog: jarl.value(debugLog) ?? null,
    diagnosis: jarl.value(diagnosis) ?? null,
    errorTypes: jarl.value(errorTypes).map(({ key, description }) => ({ key, description })),
  };
  out.stdout(`${JSON.stringify(shown, null, 2)}\n`);
  return jarl.ok(undefined);
};

export const image = async (
  services: App.Needs<Stores.Actions.Actions>,
  flags: Flags<"image">,
  out: Output,
): Done => {
  const { imageId, output } = flags;
  const data = await services.actions.getImage(imageId);
  if (jarl.is_err(data)) {
    return data;
  }
  const bytes = jarl.value(data);
  if (bytes === undefined) {
    return jarl.err(new Refused(`image: no image ${imageId}`));
  }
  const written = await jarl.exec(
    () => out.writeFile(output, bytes),
    (thrown) => new Refused(`image: could not write ${output}: ${messageOf(thrown)}`),
  );
  if (jarl.is_err(written)) {
    return written;
  }
  out.stdout(`image ${imageId} written to ${output}\n`);
  return jarl.ok(undefined);
};

const alreadyDiagnosed = (jobId: string) =>
  new Refused(`diagnose: job ${jobId} already has a diagnosis; the first stands`);

// Only a drive or setup the driver ran to its end has a verdict to give: a diagnose job is the
// reviewer's own, and any other status has no settled evidence or a verdict already. Every check
// that can runs before the first write, so a refusal mints no error type for a diagnosis not saved.
export const diagnose = async (
  services: App.Needs<Stores.Tests.Tests | Stores.Diagnosis.Diagnosis>,
  flags: Flags<"diagnose">,
  out: Output,
): Done => {
  const { jobId, verdict, type, description } = flags;
  if (verdict === "passed" && type !== undefined) {
    return jarl.err(new Refused("diagnose: --verdict passed takes no --type"));
  }
  if (verdict === "failed" && type === undefined) {
    return jarl.err(
      new Refused(
        "diagnose: --verdict failed needs --type: a key from logs' errorTypes, or a new one with --description",
      ),
    );
  }
  if (type === undefined && description !== undefined) {
    return jarl.err(new Refused("diagnose: --description describes a new --type; give it one"));
  }
  const found = await services.tests.getJob(jobId);
  if (jarl.error.is(found, Stores.Tests.NotFound)) {
    return jarl.err(new Refused(`diagnose: no job ${jobId}`));
  }
  if (jarl.is_err(found)) {
    return found;
  }
  const job = jarl.value(found);
  if (job.status !== "completed" || job.action === "diagnose") {
    return jarl.err(
      new Refused(
        `diagnose: job ${jobId} is a ${job.status} ${job.action} job; only a completed drive or setup takes a verdict`,
      ),
    );
  }
  const diagnosed = await services.diagnosis.getDiagnosis(jobId);
  if (jarl.is_err(diagnosed)) {
    return diagnosed;
  }
  if (jarl.value(diagnosed) !== undefined) {
    return jarl.err(alreadyDiagnosed(jobId));
  }
  if (type !== undefined && description === undefined) {
    const known = await services.diagnosis.findErrorType(type);
    if (jarl.is_err(known)) {
      return known;
    }
    if (jarl.value(known) === undefined) {
      return jarl.err(
        new Refused(`diagnose: no error type ${type}; give --description to mint it`),
      );
    }
  }
  if (type !== undefined && description !== undefined) {
    const minted = await services.diagnosis.createErrorType(type, description);
    if (jarl.is_err(minted)) {
      return minted;
    }
    if (!jarl.value(minted)) {
      return jarl.err(
        new Refused(
          `diagnose: error type ${type} already exists; give --type ${type} without --description`,
        ),
      );
    }
  }
  const saved = await services.diagnosis.saveDiagnosis({
    jobId,
    verdict,
    errorType: type ?? null,
    summary: flags.summary,
    model: flags.model,
  });
  if (jarl.is_err(saved)) {
    return saved;
  }
  if (!jarl.value(saved)) {
    return jarl.err(alreadyDiagnosed(jobId));
  }
  out.stdout(`job ${jobId} diagnosed ${verdict}${type === undefined ? "" : `, ${type}`}\n`);
  return jarl.ok(undefined);
};

const runCommand = (services: Services, env: Run, out: Output): Done => {
  if (env.command === "logs") {
    return logs(services, env.flags, out);
  }
  if (env.command === "image") {
    return image(services, env.flags, out);
  }
  return diagnose(services, env.flags, out);
};

// The exit code: 0 when the command worked, else 1 with its reason on stderr.
export const run = async (services: Services, env: Run, out: Output): Promise<number> => {
  const ran = await runCommand(services, env, out);
  if (jarl.is_err(ran)) {
    out.stderr(`${ran.error.message}\n`);
    return 1;
  }
  return 0;
};
