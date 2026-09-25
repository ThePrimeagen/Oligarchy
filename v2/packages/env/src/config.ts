import { fileURLToPath } from "node:url";
import * as jarl from "jarl";
import * as z from "zod";
import * as Errors from "./errors.ts";
import type * as Io from "./io.ts";

// The harness's non-secret configuration, checked in beside the package. There is no default: a
// guessed model or ceiling would run the fleet on the wrong one. A token key is refused; it stays
// in the environment.
export const PATH = fileURLToPath(new URL("../../../../oligarchy.json", import.meta.url));

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
    models: z.strictObject({ drive: ModelId, diagnose: ModelId, mint: ModelId }),
    reasoning: z.strictObject({ drive: Effort, diagnose: Effort, mint: Effort }),
    openRouterBaseUrl: z.string().refine(isHttpUrl, "must be an http or https url"),
    timeouts: z.strictObject({ header: Duration, chunk: Duration }),
    runCeiling: Duration,
    stepLimit: z.int().min(1, "stepLimit must be at least 1"),
    harness: z.strictObject({ defaultRetry: Duration }),
  })
  .superRefine((config, ctx) => {
    // Header before chunk before defaultRetry: the order the file writes them.
    const waits = [
      { path: ["timeouts", "header"], ms: config.timeouts.header },
      { path: ["timeouts", "chunk"], ms: config.timeouts.chunk },
      { path: ["harness", "defaultRetry"], ms: config.harness.defaultRetry },
    ];
    for (const wait of waits) {
      if (wait.ms >= config.runCeiling) {
        ctx.addIssue({
          code: "custom",
          path: wait.path,
          message: "must be shorter than runCeiling",
        });
      }
    }
  });

export type Config = z.output<typeof File>;

export const load = jarl.fn(
  async (io: Io.Io): Promise<Config> => {
    const text = await jarl.unwrap(io.readFile(PATH));
    const parsed = await jarl.parseJSON(text);
    if (!parsed.ok) {
      throw new Errors.ConfigInvalid(PATH, parsed.error.message);
    }
    const decoded = File.safeParse(parsed.value);
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
