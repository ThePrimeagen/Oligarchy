import * as Db from "@oligarchy/db";
import * as Schema from "@oligarchy/db/schema";
import { eq, sql } from "drizzle-orm";
import * as jarl from "jarl";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as Tests from "../src/tests.ts";
import { database, MISSING } from "./support.ts";

beforeEach(() => vi.useFakeTimers({ toFake: ["Date"] }));
afterEach(() => vi.useRealTimers());

const running = async () => {
  const h = await database();
  const definition = jarl.unwrap(
    await h.tests.defineTestDefinition({
      name: "lock-screen",
      description: "",
      instruction: "",
      proof: "",
      resume: true,
    }),
  );
  const filed = jarl.unwrap(
    await h.tests.createTestSuite({
      iso: "test.iso",
      serverUrl: "http://proxy",
      definitionIds: [definition.id],
    }),
  );
  const drive = filed.runs[0]!.jobs[0]!;
  jarl.unwrap(await h.tests.runJob(drive.id, crypto.randomUUID()));
  jarl.unwrap(await h.tests.startRun(drive.runId, "test/model"));
  const snapshot = async () => jarl.unwrap(await h.tests.getTestSuiteDetails(filed.suite.id));
  return { ...h, drive, snapshot };
};

// Fail a later write in the test-owned database to prove earlier writes are rolled back.
const refuse = async (
  db: Db.Database,
  table: "jobs" | "test_runs" | "test_suites",
  operation = "update",
  condition = "true",
) => {
  jarl.unwrap(
    await db.run(async (d) => {
      await d.execute(
        sql.raw(
          `create function refuse_completion() returns trigger language plpgsql as $$ begin if ${condition} then raise exception 'completion refused by test'; end if; return new; end $$`,
        ),
      );
      await d.execute(
        sql.raw(
          `create trigger refuse_completion before ${operation} on ${table} for each row execute function refuse_completion()`,
        ),
      );
    }),
  );
};

const diagnosing = async () => {
  const h = await running();
  const diagnose = jarl.unwrap(await h.tests.completeDrive(h.drive.id));
  jarl.unwrap(await h.tests.runJob(diagnose.id, crypto.randomUUID()));
  return { ...h, diagnose };
};

it("completes a drive with its diagnosis, then closes the diagnosis, judged job, run and suite together", async () => {
  const h = await diagnosing();
  expect(jarl.unwrap(await h.tests.getJob(h.drive.id)).status).toBe("completed");
  jarl.unwrap(
    await h.tests.completeDiagnosis(h.diagnose.id, h.drive.id, "passed", "screen locked"),
  );
  const state = await h.snapshot();
  expect(state.suite.status).toBe("passed");
  expect(state.runs[0]?.run).toMatchObject({ status: "passed", reason: "screen locked" });
  expect(state.runs[0]?.jobs).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: h.drive.id, status: "succeeded" }),
      expect.objectContaining({ id: h.diagnose.id, status: "completed" }),
    ]),
  );
});

it("rolls drive completion back when queuing its diagnosis fails, allowing the same completion to be retried", async () => {
  const h = await running();
  const before = await h.snapshot();
  await refuse(h.db, "jobs", "insert");
  expect(jarl.error.is(await h.tests.completeDrive(h.drive.id), Db.DatabaseError)).toBe(true);
  expect(await h.snapshot()).toEqual(before);
  jarl.unwrap(await h.db.run((d) => d.execute(sql.raw("drop trigger refuse_completion on jobs"))));
  const diagnose = jarl.unwrap(await h.tests.completeDrive(h.drive.id));
  expect(diagnose).toMatchObject({ runId: h.drive.runId, action: "diagnose", status: "pending" });
  expect(jarl.error.is(await h.tests.completeDrive(h.drive.id), Tests.InvalidState)).toBe(true);
  expect((await h.snapshot()).runs[0]?.jobs).toHaveLength(2);
});

it.each(["jobs", "test_runs", "test_suites"] as const)(
  "rolls every diagnosis write back when the %s update fails",
  async (table) => {
    const h = await diagnosing();
    const before = await h.snapshot();
    await refuse(h.db, table, "update", table === "jobs" ? "new.status = 'succeeded'" : "true");
    expect(
      jarl.error.is(
        await h.tests.completeDiagnosis(h.diagnose.id, h.drive.id, "passed", "proof"),
        Db.DatabaseError,
      ),
    ).toBe(true);
    expect(await h.snapshot()).toEqual(before);
    jarl.unwrap(
      await h.db.run((d) => d.execute(sql.raw(`drop trigger refuse_completion on ${table}`))),
    );
    jarl.unwrap(await h.tests.completeDiagnosis(h.diagnose.id, h.drive.id, "passed", "proof"));
    expect((await h.snapshot()).suite.status).toBe("passed");
  },
);

it.each(["test_runs", "test_suites"] as const)(
  "rolls the timeout back when its %s update fails",
  async (table) => {
    const h = await running();
    const before = await h.snapshot();
    await refuse(h.db, table);
    expect(
      jarl.error.is(await h.tests.timeoutJobAndRun(h.drive.id, "ceiling"), Db.DatabaseError),
    ).toBe(true);
    expect(await h.snapshot()).toEqual(before);
  },
);

it("times out the job and run and closes the last run's suite failed", async () => {
  const h = await running();
  jarl.unwrap(await h.tests.timeoutJobAndRun(h.drive.id, "ceiling"));
  const state = await h.snapshot();
  expect(state.suite.status).toBe("failed");
  expect(state.runs[0]?.run).toMatchObject({ status: "timed_out", reason: "ceiling" });
  expect(state.runs[0]?.jobs[0]).toMatchObject({ status: "timed_out", reason: "ceiling" });
});

it("refuses a missing job, an already-ended job, and a diagnosis of a different run without changing anything", async () => {
  const h = await diagnosing();
  const before = await h.snapshot();
  expect(jarl.error.is(await h.tests.completeDrive(MISSING), Tests.NotFound)).toBe(true);
  expect(jarl.error.is(await h.tests.completeDrive(h.drive.id), Tests.InvalidState)).toBe(true);
  expect(jarl.error.is(await h.tests.completeDrive(h.diagnose.id), Tests.InvalidState)).toBe(true);
  expect(
    jarl.error.is(
      await h.tests.completeDiagnosis(h.diagnose.id, MISSING, "passed", "proof"),
      Tests.NotFound,
    ),
  ).toBe(true);
  expect(
    jarl.error.is(
      await h.tests.completeDiagnosis(h.diagnose.id, h.diagnose.id, "passed", "proof"),
      Tests.InvalidState,
    ),
  ).toBe(true);
  const other = jarl.unwrap(
    await h.tests.createTestRun({
      definitionId: before.runs[0]!.run.definitionId,
      iso: "other.iso",
      serverUrl: "http://proxy",
    }),
  );
  jarl.unwrap(await h.tests.runJob(other.job.id, crypto.randomUUID()));
  jarl.unwrap(await h.tests.completeJob(other.job.id));
  expect(
    jarl.error.is(
      await h.tests.completeDiagnosis(h.diagnose.id, other.job.id, "passed", "proof"),
      Tests.InvalidState,
    ),
  ).toBe(true);
  expect(await h.snapshot()).toEqual(before);
});

it("rolls back completion when another open job still holds the run", async () => {
  const h = await running();
  jarl.unwrap(
    await h.db.run((d) =>
      d.insert(Schema.jobs).values({ runId: h.drive.runId, action: "diagnose" }),
    ),
  );
  const before = await h.snapshot();
  expect(jarl.error.is(await h.tests.completeDrive(h.drive.id), Tests.InvalidState)).toBe(true);
  expect(await h.snapshot()).toEqual(before);
});

it("refuses to close a diagnosis or timeout on a closed run", async () => {
  const h = await diagnosing();
  jarl.unwrap(
    await h.db.run((d) =>
      d
        .update(Schema.testRuns)
        .set({ status: "aborted" })
        .where(eq(Schema.testRuns.id, h.drive.runId)),
    ),
  );
  const before = await h.snapshot();
  expect(
    jarl.error.is(
      await h.tests.completeDiagnosis(h.diagnose.id, h.drive.id, "passed", "proof"),
      Tests.InvalidState,
    ),
  ).toBe(true);
  expect(
    jarl.error.is(await h.tests.timeoutJobAndRun(h.diagnose.id, "ceiling"), Tests.InvalidState),
  ).toBe(true);
  expect(await h.snapshot()).toEqual(before);
});
