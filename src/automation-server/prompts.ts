import { Effect, FileSystem } from "effect";
import * as Linear from "../ctrl/linear.ts";
import * as Prompts from "../ctrl/prompts.ts";
import type * as Automation from "../db/automation.ts";
import type * as Errors from "../shared/errors.ts";

export const compose = (
  job: Automation.AutomationJobRow,
  ticket: string,
  resultId: string,
): Effect.Effect<
  string,
  Errors.LinearError | Errors.PromptError,
  Linear.Linear | FileSystem.FileSystem
> =>
  job.action === "drive"
    ? Effect.flatMap(Linear.Linear, (linear) => linear.issueDescription(ticket))
    : Prompts.renderDiagnosingAgent({ LINEAR_TICKET: ticket, RESULT_ID: resultId });
