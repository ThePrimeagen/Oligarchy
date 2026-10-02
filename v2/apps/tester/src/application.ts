import type * as App from "@oligarchy/app";
import type * as Db from "@oligarchy/db";
import * as DbSchema from "@oligarchy/db/schema";
import type * as Logger from "@oligarchy/logger";
import { eq } from "drizzle-orm";
import { report } from "./report.ts";

export const main = async (app: App.App<unknown, Db.Database | Logger.Logger>) => {
  const counted = await app.services.db.run(async (db) => ({
    running: await db.$count(DbSchema.testSuites, eq(DbSchema.testSuites.status, "running")),
    passing: await db.$count(DbSchema.testRuns, eq(DbSchema.testRuns.status, "passed")),
    failing: await db.$count(DbSchema.testRuns, eq(DbSchema.testRuns.status, "failed")),
  }));
  return report(app.services.logger, counted);
};
