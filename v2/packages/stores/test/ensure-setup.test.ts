import * as jarl from "jarl";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { database } from "./support.ts";
beforeEach(() => vi.useFakeTimers({ toFake: ["Date"] }));
afterEach(() => vi.useRealTimers());
const input = { iso: "test.iso", serverUrl: "http://proxy", setupServer: "http://runner" };
it("concurrent requests file one setup and keep it while it awaits diagnosis", async () => {
  const { tests, setupRequests } = await database();
  jarl.unwrap(
    await tests.defineTestDefinition({
      name: "setup",
      description: "",
      instruction: "",
      proof: "",
      resume: false,
    }),
  );
  const attempts = await Promise.all([tests.ensureSetup(input), tests.ensureSetup(input)]);
  const filed = attempts.map((r) => jarl.unwrap(r)).filter((r) => r !== undefined);
  expect(filed).toHaveLength(1);
  expect(jarl.unwrap(await setupRequests.inspect(input.iso, input.setupServer))?.jobId).toBe(
    filed[0]?.job.id,
  );
  expect(jarl.unwrap(await tests.ensureSetup(input))).toBeUndefined();
});
it("completes an abandoned null lock and replaces a failed setup", async () => {
  const { tests, setupRequests } = await database();
  jarl.unwrap(
    await tests.defineTestDefinition({
      name: "setup",
      description: "",
      instruction: "",
      proof: "",
      resume: false,
    }),
  );
  jarl.unwrap(await setupRequests.insert(input.iso, input.setupServer));
  const first = jarl.unwrap(await tests.ensureSetup(input))!;
  jarl.unwrap(await tests.abortJob(first.job.id, "stop"));
  const second = jarl.unwrap(await tests.ensureSetup(input))!;
  expect(second.job.id).not.toBe(first.job.id);
});
it("missing setup definition leaves no new lock or orphan job", async () => {
  const { tests, setupRequests } = await database();
  expect(jarl.is_err(await tests.ensureSetup(input))).toBe(true);
  expect(jarl.unwrap(await setupRequests.list())).toEqual([]);
  expect(jarl.unwrap(await tests.listJobs())).toEqual({ pending: [], running: [] });
});
