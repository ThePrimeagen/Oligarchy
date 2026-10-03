import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as jarl from "jarl";
import * as z from "zod";
import * as Errors from "./errors.ts";
import type * as Io from "./io.ts";

// The repository's root, four directories up from these sources: a path the project names, such
// as a migrations folder, is written relative to it.
export const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

// The harness's non-secret configuration, checked in beside V2's packages: the root's is V1's,
// which still calls setup mint. There is no default: a guessed model or ceiling would run the
// fleet on the wrong one. A token key is refused; it stays in the environment.
export const PATH = join(ROOT, "v2", "oligarchy.json");

const UNIT_MS: Readonly<Record<string, number>> = {
  milli: 1,
  second: 1_000,
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 604_800_000,
};
const DURATION = /^(\d+(?:\.\d+)?) (milli|second|minute|hour|day|week)s?$/;

// "3 minutes" in the file, milliseconds in the program. Zero would never time out.
const Duration = z
  .string()
  .transform((text, ctx) => {
    const match = DURATION.exec(text);
    const unitMs = match?.[2] === undefined ? undefined : UNIT_MS[match[2]];
    if (match === null || unitMs === undefined) {
      ctx.issues.push({
        code: "custom",
        message: `"${text}" is not a duration like "3 minutes"`,
        input: text,
      });
      return z.NEVER;
    }
    return Number(match[1]) * unitMs;
  })
  .refine((ms) => ms > 0, "duration must be greater than zero");

const ModelId = z.string().regex(/^[^\s/]+\/\S+$/, "model must be provider/model");

// OpenRouter's reasoning effort, and opencode's --variant for a diagnose.
export const Effort = z.enum(["minimal", "low", "medium", "high", "xhigh"]);
export type Effort = z.output<typeof Effort>;

const isHttpUrl = (value: string): boolean => {
  if (!URL.canParse(value)) {
    return false;
  }
  const url = new URL(value);
  return (url.protocol === "http:" || url.protocol === "https:") && url.hostname !== "";
};

const File = z
  .strictObject({
    models: z.strictObject({ drive: ModelId, diagnose: ModelId, setup: ModelId }),
    reasoning: z.strictObject({ drive: Effort, diagnose: Effort, setup: Effort }),
    openRouterBaseUrl: z.string().refine(isHttpUrl, "must be an http or https url"),
    // Any HTTP call that names no deadline of its own.
    httpTimeout: Duration,
    // A drive's or setup's driver. askTimeout bounds each OpenRouter ask; recentActions is the
    // lines of a step the driving prompt shows, its intent among them. A guest's first start
    // downloads its ISO before it answers, and a save gives it time to power off.
    driver: z.strictObject({
      runCeiling: Duration,
      stepLimit: z.int().min(1, "stepLimit must be at least 1"),
      askTimeout: Duration,
      harness: z.strictObject({
        defaultRetry: Duration,
        recentActions: z.int().min(1, "recentActions must be at least 1"),
      }),
      guest: z.strictObject({ startTimeout: Duration, saveTimeout: Duration }),
    }),
    // A diagnose's opencode: killed at runCeiling, and an OpenRouter stream with no first byte,
    // or no next chunk, for its timeout is asked again.
    diagnose: z.strictObject({
      runCeiling: Duration,
      headerTimeout: Duration,
      chunkTimeout: Duration,
    }),
    // A driver is killed driverGrace past driver.runCeiling, the time it has to stop its guest.
    // A kill is SIGTERM, then SIGKILL killGrace later; a child's stderr gets stderrGrace past its
    // exit. reserveTimeout bounds asking the qemu reverse proxy for a guest.
    automationClient: z.strictObject({
      driverGrace: Duration,
      killGrace: Duration,
      stderrGrace: Duration,
      reserveTimeout: Duration,
    }),
    // abortTimeout bounds a client's /abort, which answers once its job is let go.
    automationServer: z.strictObject({
      dispatchInterval: Duration,
      forgetInterval: Duration,
      forgetAfter: Duration,
      abortTimeout: Duration,
    }),
    // Finding where to click on a screenshot. Each of `rounds` asks Clef one noul per cell of a
    // grid x grid view (64 questions at most), clicks the p^power weighted centre of the cells,
    // and the next round looks at a box boxScale x a cell around it. A round-one best cell below
    // threshold is not found. Each round sends two pictures: an overview, the whole screen shrunk to
    // overviewScale of its size, and a grid image as wide as gridImageScale x the screen's width:
    // round one's is the screen, later rounds' the box enlarged to that width. Clef sees about a
    // megapixel at most, so neither is above 1. quality is both pictures' WebP quality. callTimeout
    // bounds one Clef call; a busy, down or slow one is asked again up to retries times, retryWait
    // apart.
    locator: z.strictObject({
      grid: z
        .int()
        .min(2, "grid must be at least 2")
        .max(8, "grid must be at most 8: 64 questions"),
      rounds: z.int().min(1, "rounds must be at least 1"),
      power: z.number().positive("power must be greater than zero"),
      boxScale: z.number().min(1, "boxScale must be at least 1"),
      threshold: z.number().min(0).max(1, "threshold is a probability"),
      overviewScale: z
        .number()
        .positive("overviewScale must be greater than zero")
        .max(1, "overviewScale is at most 1"),
      gridImageScale: z
        .number()
        .positive("gridImageScale must be greater than zero")
        .max(1, "gridImageScale is at most 1"),
      quality: z.int().min(1, "quality is from 1 to 100").max(100, "quality is from 1 to 100"),
      retries: z.int().min(0, "retries must be zero or more"),
      callTimeout: Duration,
      retryWait: Duration,
    }),
  })
  .superRefine((config, ctx) => {
    const { driver, diagnose, automationClient, automationServer, locator } = config;
    if (locator.boxScale >= locator.grid) {
      ctx.addIssue({
        code: "custom",
        path: ["locator", "boxScale"],
        message: "must be smaller than locator.grid",
      });
    }
    // In the order the file writes them.
    const waits = [
      { path: ["driver", "askTimeout"], ms: driver.askTimeout, ceiling: "driver" },
      {
        path: ["driver", "harness", "defaultRetry"],
        ms: driver.harness.defaultRetry,
        ceiling: "driver",
      },
      { path: ["diagnose", "headerTimeout"], ms: diagnose.headerTimeout, ceiling: "diagnose" },
      { path: ["diagnose", "chunkTimeout"], ms: diagnose.chunkTimeout, ceiling: "diagnose" },
    ] as const;
    for (const wait of waits) {
      if (wait.ms >= config[wait.ceiling].runCeiling) {
        ctx.addIssue({
          code: "custom",
          path: [...wait.path],
          message: `must be shorter than ${wait.ceiling}.runCeiling`,
        });
      }
    }
    // A client's abort kills its child and drains its stderr, or gives a reserved guest back
    // with one HTTP call, before it answers.
    const stopping = Math.max(
      automationClient.killGrace + automationClient.stderrGrace,
      config.httpTimeout,
    );
    if (automationServer.abortTimeout <= stopping) {
      ctx.addIssue({
        code: "custom",
        path: ["automationServer", "abortTimeout"],
        message:
          "must be longer than automationClient.killGrace plus automationClient.stderrGrace, and than httpTimeout",
      });
    }
  });

export type Config = z.output<typeof File>;

export const load = jarl.fn(
  async (io: Io.Io): Promise<Config> => {
    const text = await jarl.unwrap(io.readFile(PATH));
    const parsed = await jarl.parseJSON(text);
    if (jarl.is_err(parsed)) {
      throw new Errors.ConfigInvalid(PATH, parsed.error.message);
    }
    const decoded = File.safeParse(jarl.value(parsed));
    if (!decoded.success) {
      const issue = decoded.error.issues[0];
      const where =
        issue === undefined || issue.path.length === 0
          ? ""
          : `${issue.path.map(String).join(".")}: `;
      throw new Errors.ConfigInvalid(PATH, `${where}${issue?.message ?? "invalid"}`);
    }
    return decoded.data;
  },
  Errors.keep(Errors.FileMissing, Errors.FileUnreadable, Errors.ConfigInvalid),
);
