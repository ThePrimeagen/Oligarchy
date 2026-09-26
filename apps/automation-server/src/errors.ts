import { Effect, Schema } from "effect";

// POST /run to an automation-client: unreachable, or a non-2xx. Not an API error — the
// automation server turns it into a failed job.
export class AutomationClientError extends Schema.TaggedError<AutomationClientError>(
  "@oligarchy/shared/errors/AutomationClientError",
)("AutomationClientError", {
  message: Schema.String,
  status: Schema.optionalKey(Schema.Int),
  cause: Schema.optionalKey(Schema.Defect()),
}) {}

const JOB_NOT_FOUND = `Job had "running" status but 404'd.`;

// An automation client answering 404 for a job the database has running. No correct run leaves
// the two disagreeing, so it is always reported.
export class JobNotFound extends Schema.TaggedError<JobNotFound>(
  "@oligarchy/shared/errors/JobNotFound",
)("JobNotFound", {
  message: Schema.Literal(JOB_NOT_FOUND).pipe(
    Schema.withConstructorDefault(Effect.succeed(JOB_NOT_FOUND)),
  ),
  jobId: Schema.String,
  url: Schema.String,
  cause: Schema.Defect(),
}) {}
