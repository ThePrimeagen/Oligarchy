import * as Db from "@oligarchy/db";
import type * as Logger from "@oligarchy/logger";
import * as jarl from "jarl";

// A DatabaseError's own message is the failed SQL; the driver's reason (ECONNREFUSED etc.) is its cause.
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

// Runs step. An error it returns or throws is one `<what>: <detail>` error line, and comes back.
export const attempt = async <T>(
  log: { readonly logger: Logger.Logger; readonly attribution: Logger.Attribution },
  what: string,
  step: () => Promise<jarl.Result<T, unknown>>,
): Promise<jarl.Result<T, unknown>> => {
  let result: jarl.Result<T, unknown>;
  try {
    result = await step();
  } catch (thrown) {
    result = jarl.err(thrown);
  }
  if (!result.ok) {
    log.logger.error(`${what}: ${detail(result.error)}`, log.attribution);
  }
  return result;
};
