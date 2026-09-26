import { Schema } from "effect";
import * as DbErrors from "@oligarchy/db/errors";
import * as ExternalFailure from "@oligarchy/log/external-failure";
import * as Render from "@oligarchy/log/render";
import * as Domain from "@oligarchy/shared/domain";

const isDatabaseError = Schema.is(DbErrors.DatabaseError);

// What a line says went wrong. Drizzle buries the reason (ECONNREFUSED etc.) in a DatabaseError's
// cause; its own message is the failed SQL.
export const detail = (error: unknown): string =>
  isDatabaseError(error)
    ? Render.errorDetail(ExternalFailure.causeOf(error))
    : Render.errorDetail(error);

// A prompt template that cannot be read, or names a placeholder its renderer has no value for.
export class PromptError extends Schema.TaggedError<PromptError>(
  "@oligarchy/shared/errors/PromptError",
)("PromptError", { message: Schema.String, cause: Schema.optionalKey(Schema.Defect()) }) {}

// A ticket with no job, or a job whose named action is not pending: nothing an abort can close
// without stopping a driver.
export class NoPendingAction extends Schema.TaggedError<NoPendingAction>(
  "@oligarchy/jobs/errors/NoPendingAction",
)("NoPendingAction", { ticket: Schema.String, action: Domain.AutomationAction }) {
  override get message(): string {
    return `ticket "${this.ticket}" has no ${this.action} to abort`;
  }
}

// A mint's setup row was deleted between its ticket's creation and the pin that names the
// server, so nothing would reserve the mint on the server it was made for.
export class SetupGone extends Schema.TaggedError<SetupGone>("@oligarchy/jobs/errors/SetupGone")(
  "SetupGone",
  { message: Schema.String },
) {}

// An operator's mint found the server's setup lock held by a mint still being created or run, so
// taking it would leave that mint's ticket without its server.
export class SetupHeld extends Schema.TaggedError<SetupHeld>("@oligarchy/jobs/errors/SetupHeld")(
  "SetupHeld",
  { message: Schema.String },
) {}
