import * as Env from "@oligarchy/env";

export const environment = Env.cli({
  name: "ctrl",
  description:
    "The diagnosing agent's tool: prints a drive or setup job's evidence, writes its screenshots to files, and records the one verdict on it. Reads and writes the database only. Exits 0 when the command worked, and 1 with its reason on stderr when it did not",
})
  .needs("databaseUrl")
  .command(
    "logs",
    "Print the drive or setup job under review as one JSON object: job, run, suite, definition, vmStatus, intents, actions, images (oldest first), debugLog, diagnosis and errorTypes",
  )
  .flags({ jobId: Env.args.reviewedJobId() })
  .done()
  .command("image", "Write one screenshot's bytes to --output")
  .flags({ imageId: Env.args.imageId(), output: Env.args.output() })
  .done()
  .command(
    "diagnose",
    "Record the one verdict on a completed drive or setup: passed takes no --type; failed takes an existing --type from logs' errorTypes, or a new one with its --description",
  )
  .flags({
    jobId: Env.args.reviewedJobId(),
    verdict: Env.args.verdict(),
    type: Env.args.type(false),
    description: Env.args.errorTypeDescription(false),
    summary: Env.args.summary(),
    model: Env.args.model(),
  })
  .done()
  .done();

export type Run = NonNullable<(typeof environment)["runs"]>;

export type Flags<Command extends Run["command"]> = Extract<Run, { command: Command }>["flags"];
