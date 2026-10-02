import * as DbSchema from "@oligarchy/db/schema";
import * as jarl from "jarl";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { logging } from "./support.ts";
beforeEach(() => vi.useFakeTimers({ toFake: ["Date"] }));
afterEach(() => vi.useRealTimers());
it("stores run attribution and forwards the job to Sentry", async () => {
  const h = await logging();
  const runId = crypto.randomUUID(),
    jobId = crypto.randomUUID();
  jarl.unwrap(
    await h.db.run(async (d) => {
      const [definition] = await d
        .insert(DbSchema.testDefinitions)
        .values({ name: "test", description: "", instruction: "", proof: "", resume: false })
        .returning();
      await d
        .insert(DbSchema.testRuns)
        .values({ id: runId, definitionId: definition!.id, iso: "iso", serverUrl: "http://proxy" });
    }),
  );
  h.logger.error("guest failed", { runId, jobId, location: "qemu-runner" });
  await h.logger.flush();
  const rows = jarl.unwrap(await h.db.run((d) => d.select().from(DbSchema.logs)));
  expect(rows.at(-1)?.runId).toBe(runId);
  expect(h.sent.at(-1)).toMatchObject({ jobId });
});
