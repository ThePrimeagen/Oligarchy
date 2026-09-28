import type * as Db from "@oligarchy/db";
import type * as Log from "@oligarchy/log";
import * as jarl from "jarl";

export type Counts = {
  readonly running: number;
  readonly passing: number;
  readonly failing: number;
};

const AS = { location: "tester" } as const;

export const report = (
  log: Log.Log,
  counted: jarl.Result<Counts, Db.DatabaseError>,
): jarl.Result<void, Db.DatabaseError> => {
  if (!counted.ok) {
    log.error(`could not count tests: ${counted.error.message}`, AS);
    return counted;
  }
  const { running, passing, failing } = counted.value;
  log.info(`running test suites: ${String(running)}`, AS);
  log.info(`passing tests: ${String(passing)}`, AS);
  (failing > 0 ? log.warning : log.info)(`failing tests: ${String(failing)}`, AS);
  return jarl.ok(undefined);
};
