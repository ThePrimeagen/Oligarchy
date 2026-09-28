import * as Db from "@oligarchy/db";
import * as jarl from "jarl";

// Where the automation server's own lines go.
export const AUTOMATION = "automation";

// A test run that names no definition the table has.
export const NoDefinition = jarl.error.define("NoDefinition");
export type NoDefinition = InstanceType<typeof NoDefinition>;

// A prompt template that cannot be read, or names a placeholder its renderer has no value for.
export const PromptError = jarl.error.define("PromptError");
export type PromptError = InstanceType<typeof PromptError>;

// A ticket with no job, or a job whose named action is not pending: nothing an abort can close
// without stopping a driver.
export const NoPendingAction = jarl.error.define("NoPendingAction");
export type NoPendingAction = InstanceType<typeof NoPendingAction>;

// A mint's setup row was deleted between its ticket's creation and the pin that names the
// server, so nothing would reserve the mint on the server it was made for.
export const SetupGone = jarl.error.define("SetupGone");
export type SetupGone = InstanceType<typeof SetupGone>;

// An operator's mint found the server's setup lock held by a mint still being created or run, so
// taking it would leave that mint's ticket without its server.
export const SetupHeld = jarl.error.define("SetupHeld");
export type SetupHeld = InstanceType<typeof SetupHeld>;

// What a line says went wrong. A DatabaseError's own message is the failed SQL; the driver's
// reason (ECONNREFUSED etc.) is its cause.
export const detail = (error: unknown): string => {
  if (jarl.error.is(error, Db.DatabaseError) && error.cause instanceof Error) {
    return error.cause.message;
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return String(error);
};

// The class under Error that `error` descends from: the one whose constructor takes a message.
const messageClass = (error: Error): Function => {
  let found: Function = error.constructor;
  for (
    let above = Object.getPrototypeOf(found);
    above !== Error;
    above = Object.getPrototypeOf(found)
  ) {
    if (typeof above !== "function" || above === Function.prototype) {
      return error.constructor;
    }
    found = above;
  }
  return found;
};

// The same error, of the same kind, fields and cause, saying message. It is built by the class
// that takes a message, so a kind whose constructor takes more (Http's take what was asked, the
// status and the body) is still made whole; its fields are then copied from `error`.
export const renamed = <E extends Error>(error: E, message: string): E => {
  const named: E = Reflect.construct(messageClass(error), [message], error.constructor);
  Object.assign(named, error);
  named.cause = error.cause;
  return named;
};
