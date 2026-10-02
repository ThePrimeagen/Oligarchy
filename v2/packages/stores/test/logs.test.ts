import * as DbSchema from "@oligarchy/db/schema";
import { eq } from "drizzle-orm";
import * as jarl from "jarl";
import { describe, expect, it } from "vitest";
import * as Tests from "../src/tests.ts";
import { database, MISSING, newJob } from "./support.ts";

const at = (seconds: number) => new Date(Date.UTC(2026, 8, 29, 12, 0, seconds));

describe("a job's log lines", () => {
  it("are its test run's lines from when it was queued until the run's next job was queued, oldest first (happy)", async () => {
    const { db, tests, logs } = await database();
    const first = await newJob(tests);
    jarl.unwrap(await tests.abortJob(first.id, "the guest never booted"));
    const second = jarl.unwrap(await tests.createJob(first.runId, "drive"));
    const elsewhere = await newJob(tests);
    const queued = async (jobId: string, seconds: number) =>
      jarl.unwrap(
        await db.run((d) =>
          d
            .update(DbSchema.jobs)
            .set({ createdAt: at(seconds) })
            .where(eq(DbSchema.jobs.id, jobId)),
        ),
      );
    await queued(first.id, 0);
    await queued(second.id, 10);
    await queued(elsewhere.id, 0);
    const line = async (seconds: number, runId: string | null, text: string) =>
      jarl.unwrap(
        await db.run((d) =>
          d
            .insert(DbSchema.logs)
            .values({ text, runId, location: "qemu-server", createdAt: at(seconds) }),
        ),
      );
    await line(6, first.runId, "downloading omarchy.iso");
    await line(2, first.runId, "reserved on qemu-1");
    await line(3, elsewhere.runId, "another run's line");
    await line(4, null, "a line about no run");
    await line(10, first.runId, "reserved on qemu-2");

    const texts = async (jobId: string) =>
      jarl.unwrap(await logs.listJobLogs(jobId)).map((row) => row.text);
    expect(await texts(first.id)).toEqual(["reserved on qemu-1", "downloading omarchy.iso"]);
    expect(await texts(second.id)).toEqual(["reserved on qemu-2"]);
  });

  it("of a job that does not exist are refused with NotFound (unhappy)", async () => {
    const { logs } = await database();

    const listed = await logs.listJobLogs(MISSING);

    if (!jarl.error.is(listed, Tests.NotFound)) {
      throw new Error("expected NotFound");
    }
    expect(listed.error.message).toBe(`listJobLogs: no job ${MISSING}`);
  });
});

describe("the logs", () => {
  it("a test run's intents are its own intent lines, in order (happy)", async () => {
    const { tests, logs } = await database();
    const { runId } = await newJob(tests);
    const { runId: other } = await newJob(tests);
    const line = (text: string, run: string | null) =>
      logs.insertLog({ text, level: "info", location: "automation-client", runId: run });
    jarl.unwrap(await line("intent start; open the lock screen", runId));
    jarl.unwrap(await line("clicked", runId));
    jarl.unwrap(await line("intent start; someone else's", other));
    jarl.unwrap(await line("intent end", runId));
    jarl.unwrap(await line("intent end", null));

    expect(jarl.unwrap(await logs.listIntents(runId)).map((intent) => intent.text)).toEqual([
      "intent start; open the lock screen",
      "intent end",
    ]);
    expect(
      jarl.unwrap(await logs.listLogs("automation-client")).map((row) => [row.runId, row.text]),
    ).toEqual([
      [runId, "intent start; open the lock screen"],
      [runId, "clicked"],
      [other, "intent start; someone else's"],
      [runId, "intent end"],
      [null, "intent end"],
    ]);
  });

  it("a line naming a test run that does not exist is still stored (unhappy)", async () => {
    const { logs } = await database();

    jarl.unwrap(
      await logs.insertLog({ text: "late", level: "error", location: "tester", runId: MISSING }),
    );

    expect(
      jarl
        .unwrap(await logs.listRecent(10))
        .map((row) => [row.level, row.location, row.runId, row.text]),
    ).toEqual([["error", "tester", MISSING, "late"]]);
    expect(jarl.unwrap(await logs.listIntents(MISSING))).toEqual([]);
  });
});
