import * as Exits from "@oligarchy/driver/exits";
import * as Env from "@oligarchy/env";
import type * as Logger from "@oligarchy/logger";
import * as jarl from "jarl";
import * as Child from "./child.ts";
import type * as Reserve from "./reserve.ts";
import * as Routes from "./routes.ts";

const LOCATION = "automation-client";

// A headless run has nobody to answer a permission prompt. --auto approves the root session's
// asks, but a subagent asks into the void and the run deadlocks (anomalyco/opencode#36868), so
// the two permissions that default to ask are allowed for every session: a screenshot read outside
// the working directory, the same get-image repeated while a guest boots. OpenRouter streams have
// no timeout of their own (anomalyco/opencode#37580): diagnose's header and chunk timeouts abort a
// request with no first byte or next chunk, which opencode retries, rather than holding the run to
// its ceiling.
const opencodeConfig = (diagnose: Env.Config["diagnose"]) =>
  JSON.stringify({
    permission: { external_directory: "allow", doom_loop: "allow" },
    provider: {
      openrouter: {
        options: { headerTimeout: diagnose.headerTimeout, chunkTimeout: diagnose.chunkTimeout },
      },
    },
  });

export type Options = {
  readonly reservations: Pick<Reserve.Reservations, "take">;
  readonly spawn: Child.Spawn;
  // This process's own environment, which every child inherits.
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly serverUrl: string;
  readonly config: Pick<
    Env.Config,
    "models" | "reasoning" | "driver" | "diagnose" | "automationClient"
  >;
  readonly vars: {
    readonly databaseUrl: Env.Secret;
    readonly oligarchyToken: Env.Secret;
    readonly openRouterToken: Env.Secret;
  };
  readonly logger: Logger.Logger;
};

type Command = {
  readonly name: string;
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly env: Readonly<Record<string, string>>;
  readonly cwd?: string;
  readonly ceilingMs: number;
  // The exit the child gives when its own run ceiling stopped it; only the driver has one.
  readonly timedOutExit?: number;
};

const failed = (message: string) => jarl.err(new Routes.RunFailed(message));

// A run spawns the driver for a drive or setup, which renders its own prompt, and opencode for a
// diagnose, and answers once the child has ended; only then is the job let go.
export const create = (options: Options): Routes.Sessions["run"] => {
  const { reservations, spawn, env, serverUrl, config, vars, logger } = options;

  // The variables may have come from an --env-file, which a child does not read.
  const secrets = () => ({
    DATABASE_URL: vars.databaseUrl.reveal(),
    OLIGARCHY_TOKEN: vars.oligarchyToken.reveal(),
    OPENROUTER_API_KEY: vars.openRouterToken.reveal(),
  });

  const driver = (jobId: string): Command => ({
    name: "driver",
    command: `${Env.ROOT}v2/driver`,
    args: ["--job-id", jobId, "--server-url", serverUrl],
    env: secrets(),
    ceilingMs: config.driver.runCeiling + config.automationClient.driverGrace,
    timedOutExit: Exits.TIMED_OUT,
  });

  // opencode reads the first segment of --model as its provider, so the OpenRouter id goes under
  // openrouter whatever it starts with. The agent's ./ctrl is V2's.
  const opencode = (prompt: string): Command => ({
    name: "opencode",
    command: "opencode",
    args: [
      "run",
      "--auto",
      "--model",
      `openrouter/${config.models.diagnose}`,
      "--variant",
      config.reasoning.diagnose,
      "--",
      prompt,
    ],
    env: { ...secrets(), OPENCODE_CONFIG_CONTENT: opencodeConfig(config.diagnose) },
    cwd: `${Env.ROOT}v2`,
    ceilingMs: config.diagnose.runCeiling,
  });

  // A failure is the answer, which the automation server logs; the lines here only say the child
  // came and went, and never carry its stderr.
  const runChild = async (
    jobId: string,
    taken: Reserve.Taken,
    command: Command,
  ): ReturnType<Routes.Sessions["run"]> => {
    const report = { location: LOCATION, jobId };
    logger.info(`starting ${command.name} for a ${taken.action}`, report);
    const child = Child.start(spawn, command.command, command.args, {
      env: { ...env, ...command.env },
      ...(command.cwd === undefined ? {} : { cwd: command.cwd }),
      killGraceMs: config.automationClient.killGrace,
      stderrGraceMs: config.automationClient.stderrGrace,
    });
    let stopped: "aborted" | "ceiling" | undefined;
    const onAbort = () => {
      if (child.kill()) {
        stopped ??= "aborted";
      }
    };
    taken.signal.addEventListener("abort", onAbort, { once: true });
    const ceiling = setTimeout(() => {
      if (child.kill()) {
        stopped ??= "ceiling";
      }
    }, command.ceilingMs);
    const ended = await child.ended;
    clearTimeout(ceiling);
    taken.signal.removeEventListener("abort", onAbort);
    if (jarl.is_err(ended)) {
      logger.info(`${command.name} could not start`, report);
      await taken.release();
      return failed(`could not start ${command.name}: ${ended.error.message}`);
    }
    const exit = jarl.value(ended);
    const exited = `${command.name} exited ${String(exit.code ?? exit.signal)}`;
    logger.info(exited, report);
    await taken.release();
    if (stopped === "aborted") {
      return jarl.ok("aborted");
    }
    if (stopped === "ceiling") {
      return jarl.err(
        new Routes.RunTimedOut(
          `${command.name} exceeded its ceiling of ${String(command.ceilingMs)} ms`,
        ),
      );
    }
    if (exit.code === 0) {
      return jarl.ok("ended");
    }
    if (command.timedOutExit !== undefined && exit.code === command.timedOutExit) {
      return jarl.err(
        new Routes.RunTimedOut(
          `${command.name} timed out: run ceiling of ${String(config.driver.runCeiling)} ms`,
        ),
      );
    }
    return failed(exit.stderr === "" ? exited : exit.stderr);
  };

  return async ({ jobId, prompt }) => {
    const taken = reservations.take(jobId);
    if (taken === undefined) {
      return failed(`job ${jobId} has no reservation`);
    }
    if (taken.action !== "diagnose") {
      return runChild(jobId, taken, driver(jobId));
    }
    if (prompt === undefined) {
      await taken.release();
      return failed(`job ${jobId} is a diagnose, which needs its prompt`);
    }
    return runChild(jobId, taken, opencode(prompt));
  };
};
