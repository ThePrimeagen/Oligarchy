import { basename, join } from "node:path";
import type * as App from "@oligarchy/app";
import type * as Db from "@oligarchy/db";
import * as Env from "@oligarchy/env";
import * as QemuHttpTools from "@oligarchy/qemu-http-tools";
import type * as Stores from "@oligarchy/stores";
import * as jarl from "jarl";

const DIR = join(Env.ROOT, "v2", "prompts");
export const DRIVING = join(DIR, "driving-agent.html");
export const DIAGNOSING = join(DIR, "diagnosing-agent.html");
// V2's ctrl is ported last; until it is, the diagnosing agent is guided by V1's.
export const CTRL_DIAGNOSE = join(Env.ROOT, "ctrl-diagnose.md");

// The guides a template may embed, by the name it uses. Each is read only when its template names
// it, so a guide that cannot be read stops only the prompts that embed it.
const GUIDES: Readonly<Record<string, string>> = { CTRL_DIAGNOSE_MD: CTRL_DIAGNOSE };

const PLACEHOLDER = /\{\{([A-Z_]+)\}\}/g;

const TOOLS = QemuHttpTools.definitions.map((tool) => tool.function.name).join(", ");

// A template names a placeholder nothing fills: sent as it is, the agent would read the braces.
export const PromptUnfilled = jarl.error.define("PromptUnfilled");
export type PromptUnfilled = InstanceType<typeof PromptUnfilled>;

export type Failure =
  | Db.DatabaseError
  | Stores.Tests.NotFound
  | Env.FileMissing
  | Env.FileUnreadable
  | PromptUnfilled;

export type Options = {
  readonly readFile: Env.Io["readFile"];
  readonly models: Env.Config["models"];
};

export type Prompts = {
  // What the agent that runs the job is told, known by the job's id. A drive or setup gets the
  // driving prompt with its definition's mission; a diagnose the diagnosing prompt naming its test
  // run. The templates are read each time, so an edited one counts from the next job.
  readonly forJob: (jobId: string) => Promise<jarl.Result<string, Failure>>;
};

export const create = (services: App.Needs<Stores.Tests.Tests>, options: Options): Prompts => {
  const { readFile, models } = options;

  // One pass over the template, so a value's own braces are never taken for placeholders.
  const render = async (
    path: string,
    values: Readonly<Record<string, string>>,
  ): Promise<jarl.Result<string, Env.FileMissing | Env.FileUnreadable | PromptUnfilled>> => {
    const read = await readFile(path);
    if (jarl.is_err(read)) {
      return read;
    }
    const text = jarl.value(read);
    const known: Record<string, string> = { ...values };
    for (const [name, guide] of Object.entries(GUIDES)) {
      if (text.includes(`{{${name}}}`)) {
        const embedded = await readFile(guide);
        if (jarl.is_err(embedded)) {
          return embedded;
        }
        known[name] = jarl.value(embedded).trimEnd();
      }
    }
    let missing: string | undefined;
    const filled = text.replace(PLACEHOLDER, (placeholder, name: string) => {
      const value = known[name];
      if (value === undefined) {
        missing ??= name;
        return placeholder;
      }
      return value;
    });
    if (missing !== undefined) {
      return jarl.err(
        new PromptUnfilled(`prompt: ${basename(path)} uses {{${missing}}}, which has no value`),
      );
    }
    return jarl.ok(filled);
  };

  return {
    forJob: async (jobId) => {
      const found = await services.tests.getJobDetails(jobId);
      if (jarl.is_err(found)) {
        return found;
      }
      const { job, run, definition } = jarl.value(found);
      if (job.action === "diagnose") {
        return render(DIAGNOSING, { JOB_ID: job.id, RUN_ID: run.id, MODEL: models.diagnose });
      }
      return render(DRIVING, {
        JOB_ID: job.id,
        MODEL: models[job.action],
        TOOLS,
        NAME: definition.name,
        DESCRIPTION: definition.description,
        INSTRUCTION: definition.instruction,
        PROOF: definition.proof,
      });
    },
  };
};
