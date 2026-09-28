import type * as Db from "@oligarchy/db";
import type * as Logger from "@oligarchy/logger";
import * as jarl from "jarl";

export type Counts = {
  readonly running: number;
  readonly passing: number;
  readonly failing: number;
};

const AS = { location: "tester" } as const;

export const report = (
  logger: Logger.Logger,
  counted: jarl.Result<Counts, Db.DatabaseError>,
): jarl.Result<void, Db.DatabaseError> => {
  if (!counted.ok) {
    logger.error(`could not count tests: ${counted.error.message}`, AS);
    return counted;
  }
  const { running, passing, failing } = counted.value;
  logger.info(`running test suites: ${String(running)}`, AS);
  logger.info(`passing tests: ${String(passing)}`, AS);
  (failing > 0 ? logger.warning : logger.info)(`failing tests: ${String(failing)}`, AS);
  return jarl.ok(undefined);
};
