import type * as App from "@oligarchy/app";
import * as DriveHarness from "@oligarchy/drive-harness";
import type * as Env from "@oligarchy/env";
import type * as Http from "@oligarchy/http";
import type * as Logger from "@oligarchy/logger";
import * as OpenRouter from "@oligarchy/openrouter";
import * as Qemu from "@oligarchy/qemu-http-tools";
import type * as Stores from "@oligarchy/stores";
import * as jarl from "jarl";

const LOCATION = "driver";

// Three in a row: the model cannot answer as a move, and asking again only spends the run. A move
// that reaches the guest, even one the guest refuses, starts the count again.
const BAD_REPLY_LIMIT = 3;

// The job is a diagnose, which is opencode's and not the driver's. Nothing was started.
export const NotDrivable = jarl.error.define("NotDrivable");
export type NotDrivable = InstanceType<typeof NotDrivable>;

export type Services = App.Needs<
  Logger.Logger | Stores.Tests.Tests | OpenRouter.OpenRouter | Http.Http
>;

type Steps = "loadJobHarnessData" | "start" | "getImage" | "ask" | "act" | "finish";

// What the harness's steps can fail with, each error once.
type Refused = Extract<
  Awaited<ReturnType<DriveHarness.DriveHarness[Steps]>>,
  { readonly ok: false }
>["error"];

// The system failed the drive, as the step that failed returned it: the job could not be loaded
// or started, or the proxy or the model could not be reached. A test that failed is an Ended.
export type Failure = Refused | NotDrivable;

export type Limits = Pick<Env.Config, "models" | "reasoning"> & {
  readonly driver: Pick<Env.Config["driver"], "runCeiling" | "stepLimit" | "harness" | "guest">;
};

// How the drive ended. Its guest is stopped with it, a drive that timed out as failed.
export type Ended = {
  readonly status: "succeeded" | "failed" | "aborted" | "timed_out";
  readonly reason?: string;
};

export type Options = {
  readonly jobId: string;
  // The qemu reverse proxy holding the job's guest, and the bearer it takes.
  readonly serverUrl: string;
  readonly token: { readonly reveal: () => string };
  readonly config: Limits;
};

const reasonOf = (signal: AbortSignal): string =>
  signal.reason instanceof Error ? signal.reason.message : String(signal.reason);

// Each turn: the screen, the model's turn, its move. Ends when the model is done, at a limit, when
// the guest is off, or on the signal.
const mainLoop = async (
  services: Services,
  harness: DriveHarness.DriveHarness,
  signal: AbortSignal,
  action: "drive" | "setup",
  options: Options,
): Promise<jarl.Result<Ended, Failure>> => {
  const { logger } = services;
  const { config } = options;
  const at = { location: LOCATION, jobId: options.jobId, runId: harness.data.runId };
  const { runCeiling, stepLimit } = config.driver;
  const deadline = Date.now() + runCeiling;
  const request = {
    model: config.models[action],
    reasoning: config.reasoning[action],
    deadline,
  };
  const aborted = (): jarl.Result<Ended, never> =>
    jarl.ok({ status: "aborted", reason: reasonOf(signal) });
  let moves = 0;
  let misses: Array<string> = [];

  while (true) {
    if (signal.aborted) {
      return aborted();
    }
    if (moves >= stepLimit) {
      return jarl.ok({
        status: "failed",
        reason: `step limit of ${String(stepLimit)} reached`,
      });
    }
    if (Date.now() >= deadline) {
      return jarl.ok({
        status: "timed_out",
        reason: `run ceiling of ${String(runCeiling)} ms passed`,
      });
    }

    const image = await harness.getImage();
    // A setup's last act powers its guest off: there is nothing left to drive, and the disk is
    // saved. A drive's guest is never meant to go off.
    if (jarl.error.is(image, Qemu.GuestOff)) {
      return jarl.ok(
        action === "setup"
          ? { status: "succeeded" }
          : { status: "failed", reason: `the guest is off: ${image.error.message}` },
      );
    }
    if (jarl.is_err(image)) {
      return signal.aborted ? aborted() : image;
    }

    const turn = await harness.ask(request);
    if (jarl.error.is(turn, OpenRouter.OpenRouterOutOfTime)) {
      return jarl.ok({ status: "timed_out", reason: turn.error.message });
    }
    if (jarl.is_err(turn)) {
      return signal.aborted ? aborted() : turn;
    }

    const acted = await harness.act(jarl.value(turn));
    if (jarl.is_ok(acted)) {
      const move = jarl.value(acted);
      if (move.kind === "done") {
        return jarl.ok({ status: "succeeded" });
      }
      moves += 1;
      misses = [];
      logger.info(
        `step ${String(move.step)}: ${move.name} ${JSON.stringify(move.arguments)}: ${move.reason}`,
        at,
      );
      continue;
    }
    if (
      jarl.error.is(acted, DriveHarness.ReplyInvalid) ||
      jarl.error.is(acted, Qemu.ToolInvalid) ||
      jarl.error.is(acted, Qemu.NoPointer)
    ) {
      misses.push(acted.error.message);
      logger.warning(acted.error.message, at);
      if (misses.length >= BAD_REPLY_LIMIT) {
        return jarl.ok({
          status: "failed",
          reason: `model could not respond correctly: ${String(BAD_REPLY_LIMIT)} bad replies in a row: ${misses.join("; ")}`,
        });
      }
      continue;
    }
    if (jarl.error.is(acted, Qemu.GuestOff)) {
      moves += 1;
      misses = [];
      logger.warning(acted.error.message, at);
      continue;
    }
    return signal.aborted ? aborted() : acted;
  }
};

// One drive or setup job, from its load to its guest's stop. A test that failed is still a drive
// that ran to its end; only the system failing it is a Failure, returned as it came. Each
// failure is logged with itself as the cause, so Sentry gets the error and its stack. The signal
// aborts on SIGINT or SIGTERM; the guest is then stopped aborted.
export const drive = async (
  services: Services,
  signal: AbortSignal,
  options: Options,
): Promise<jarl.Result<Ended, Failure>> => {
  const { logger } = services;
  const { harness: shown, guest } = options.config.driver;
  const harness = DriveHarness.create(services, signal, {
    job: options.jobId,
    baseUrl: options.serverUrl,
    token: options.token,
    recentActions: shown.recentActions,
    startTimeoutMs: guest.startTimeout,
    saveTimeoutMs: guest.saveTimeout,
  });
  const at = { location: LOCATION, jobId: options.jobId };
  const loaded = await harness.loadJobHarnessData(options.jobId);
  if (jarl.is_err(loaded)) {
    logger.error(loaded.error.message, { ...at, cause: loaded.error });
    return loaded;
  }
  const { action, name, iso, resume, runId } = harness.data;
  const attributed = { ...at, runId };
  const report = (error: Failure) => logger.error(error.message, { ...attributed, cause: error });
  if (action === "diagnose") {
    const refused = new NotDrivable(
      `job ${options.jobId} is a diagnose; the driver runs a drive or a setup`,
    );
    report(refused);
    return jarl.err(refused);
  }
  const started = await harness.start();
  if (jarl.is_err(started)) {
    report(started.error);
    return started;
  }
  logger.info(`${action} ${name}: started ${iso}${resume ? ", resumed" : ""}`, attributed);

  const looped = await mainLoop(services, harness, signal, action, options);
  if (jarl.is_err(looped)) {
    report(looped.error);
    const stopped = await harness.finish({ status: "failed", reason: looped.error.message });
    if (jarl.is_err(stopped)) {
      report(stopped.error);
    }
    return looped;
  }

  const ended = jarl.value(looped);
  const { status, reason } = ended;
  const finished = await harness.finish({
    status: status === "timed_out" ? "failed" : status,
    ...(reason === undefined ? {} : { reason }),
  });
  // The model finished a setup without powering its guest off, so nothing was kept.
  if (jarl.error.is(finished, Qemu.NotPoweredOff)) {
    const unfinished = { status: "failed", reason: finished.error.message } as const;
    const stopped = await harness.finish(unfinished);
    if (jarl.is_err(stopped)) {
      report(stopped.error);
    }
    logger.info(`ended failed: ${finished.error.message}`, attributed);
    return jarl.ok(unfinished);
  }
  if (jarl.is_err(finished)) {
    report(finished.error);
    return finished;
  }
  logger.info(
    `ended ${ended.status}${ended.reason === undefined ? "" : `: ${ended.reason}`}`,
    attributed,
  );
  return looped;
};
