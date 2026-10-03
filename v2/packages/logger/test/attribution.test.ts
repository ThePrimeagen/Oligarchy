import * as DbSchema from "@oligarchy/db/schema";
import * as jarl from "jarl";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { logging } from "./support.ts";
beforeEach(() => vi.useFakeTimers({ toFake: ["Date"] }));
afterEach(() => vi.useRealTimers());
it("stores job and run attribution independently and forwards the job to Sentry", async () => {
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
  h.logger.info("job not found", { jobId });
  h.logger.info("run ended", { runId });
  h.logger.info("server stopped");
  await h.logger.flush();
  const rows = jarl.unwrap(
    await h.db.run((d) => d.select().from(DbSchema.logs).orderBy(DbSchema.logs.id)),
  );
  expect(rows.map((row) => ({ text: row.text, runId: row.runId, jobId: row.jobId }))).toEqual([
    { text: "guest failed", runId, jobId },
    { text: "job not found", runId: null, jobId },
    { text: "run ended", runId, jobId: null },
    { text: "server stopped", runId: null, jobId: null },
  ]);
  expect(h.sent.at(-1)).toMatchObject({ jobId });
});
