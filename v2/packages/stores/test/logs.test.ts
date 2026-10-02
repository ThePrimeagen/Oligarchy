import * as jarl from "jarl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { database, MISSING, newJob } from "./support.ts";

beforeEach(() => vi.useFakeTimers({ toFake: ["Date"] }));
afterEach(() => vi.useRealTimers());

describe("the logs", () => {
  it("keeps each job's evidence separate and includes all attempts in the run's history (happy)", async () => {
    const { tests, logs } = await database();
    const first = await newJob(tests);
    const { runId } = first;
    jarl.unwrap(await tests.abortJob(first.id, "retry"));
    const retry = jarl.unwrap(await tests.createJob(runId, "drive"));
    const other = await newJob(tests);
    const line = (text: string, run: string | null, job: string | null) =>
      logs.insertLog({
        text,
        level: "info",
        location: "automation-client",
        runId: run,
        jobId: job,
      });
    jarl.unwrap(await line("intent start; first attempt", runId, first.id));
    jarl.unwrap(await line("clicked", runId, first.id));
    jarl.unwrap(await line("intent start; someone else's", other.runId, other.id));
    jarl.unwrap(await line("intent start; retry", runId, retry.id));
    jarl.unwrap(await line("intent end", runId, retry.id));
    jarl.unwrap(await line("intent start; legacy", runId, null));
    jarl.unwrap(await line("intent end", null, null));

    expect(
      jarl.unwrap(await logs.listIntents({ jobId: retry.id })).map((intent) => intent.text),
    ).toEqual(["intent start; retry", "intent end"]);
    expect(
      jarl.unwrap(await logs.listIntents({ jobId: first.id })).map((intent) => intent.text),
    ).toEqual(["intent start; first attempt"]);
    expect(jarl.unwrap(await logs.listIntents({ runId })).map((intent) => intent.text)).toEqual([
      "intent start; first attempt",
      "intent start; retry",
      "intent end",
      "intent start; legacy",
    ]);
    expect(jarl.unwrap(await logs.listLogs({ jobId: first.id })).map((row) => row.text)).toEqual([
      "intent start; first attempt",
      "clicked",
    ]);
    expect(jarl.unwrap(await logs.listLogs({ runId })).map((row) => row.text)).toEqual([
      "intent start; first attempt",
      "clicked",
      "intent start; retry",
      "intent end",
      "intent start; legacy",
    ]);
    expect(
      jarl
        .unwrap(await logs.listLogs({ location: "automation-client" }))
        .map((row) => [row.runId, row.jobId, row.text]),
    ).toEqual([
      [runId, first.id, "intent start; first attempt"],
      [runId, first.id, "clicked"],
      [other.runId, other.id, "intent start; someone else's"],
      [runId, retry.id, "intent start; retry"],
      [runId, retry.id, "intent end"],
      [runId, null, "intent start; legacy"],
      [null, null, "intent end"],
    ]);
  });

  it("a line naming a run and job that do not exist is still stored (unhappy)", async () => {
    const { logs } = await database();
    jarl.unwrap(
      await logs.insertLog({
        text: "late",
        level: "error",
        location: "tester",
        runId: MISSING,
        jobId: MISSING,
      }),
    );
    expect(
      jarl
        .unwrap(await logs.listRecent(10))
        .map((row) => [row.level, row.location, row.runId, row.jobId, row.text]),
    ).toEqual([["error", "tester", MISSING, MISSING, "late"]]);
    expect(jarl.unwrap(await logs.listIntents({ runId: MISSING }))).toEqual([]);
    expect(jarl.unwrap(await logs.listIntents({ jobId: MISSING }))).toEqual([]);
  });
});
