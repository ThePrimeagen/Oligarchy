import * as jarl from "jarl";
import { describe, expect, it } from "vitest";
import { database, MISSING, newJob } from "./support.ts";

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
