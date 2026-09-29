import * as Db from "@oligarchy/db";
import * as jarl from "jarl";
import { describe, expect, it } from "vitest";
import { database, newJob } from "./support.ts";

describe("a job's diagnosis", () => {
  it("a reviewed job reads back its verdict (happy)", async () => {
    const { tests, diagnosis } = await database();
    const drive = await newJob(tests);
    jarl.unwrap(await diagnosis.createErrorType("lock-screen-missed", "the lock never showed"));

    const saved = await diagnosis.saveDiagnosis({
      jobId: drive.id,
      verdict: "failed",
      errorType: "lock-screen-missed",
      summary: "no lock screen in the last capture",
      model: "muse-spark-1.3",
    });

    expect(jarl.unwrap(saved)).toBe(true);
    expect(jarl.unwrap(await diagnosis.getDiagnosis(drive.id))).toMatchObject({
      jobId: drive.id,
      verdict: "failed",
      errorType: "lock-screen-missed",
    });
  });

  it("a second diagnosis of a job is refused and the first stands (unhappy)", async () => {
    const { tests, diagnosis } = await database();
    const drive = await newJob(tests);
    const input = { jobId: drive.id, errorType: null, summary: "fine", model: "m" };
    jarl.unwrap(await diagnosis.saveDiagnosis({ ...input, verdict: "passed" }));

    const again = await diagnosis.saveDiagnosis({ ...input, summary: "again", verdict: "passed" });

    expect(jarl.unwrap(again)).toBe(false);
    expect(jarl.unwrap(await diagnosis.getDiagnosis(drive.id))?.summary).toBe("fine");
  });

  it("a job nobody reviewed has no diagnosis (unhappy)", async () => {
    const { tests, diagnosis } = await database();
    const drive = await newJob(tests);

    expect(jarl.unwrap(await diagnosis.getDiagnosis(drive.id))).toBeUndefined();
  });

  it("a passed verdict naming a cause is a database error and nothing is stored (unhappy)", async () => {
    const { tests, diagnosis } = await database();
    const drive = await newJob(tests);
    jarl.unwrap(await diagnosis.createErrorType("lock-screen-missed", "the lock never showed"));

    const saved = await diagnosis.saveDiagnosis({
      jobId: drive.id,
      verdict: "passed",
      errorType: "lock-screen-missed",
      summary: "",
      model: "m",
    });

    expect(jarl.error.is(saved, Db.DatabaseError)).toBe(true);
    expect(jarl.unwrap(await diagnosis.getDiagnosis(drive.id))).toBeUndefined();
  });
});
