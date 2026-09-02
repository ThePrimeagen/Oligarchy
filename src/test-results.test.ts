import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { reportTestResult } from "./test-results.ts";
import type { Db } from "./db/ops.ts";
import { agentRuns, testResults } from "./db/schema.ts";

function testDatabase(agent?: { sessionId: string }, existing?: { id: string }) {
  const updates: { table: unknown; values: unknown }[] = [];
  const db = {
    select: () => ({
      from: (table: unknown) => {
        assert.equal(table, agentRuns);
        return {
          where: async () => (agent === undefined ? [] : [agent]),
        };
      },
    }),
    update: (table: unknown) => ({
      set: (values: unknown) => ({
        where: () => ({
          returning: async () => {
            updates.push({ table, values });
            return existing === undefined ? [] : [existing];
          },
        }),
      }),
    }),
  } as unknown as Db;
  return { db, updates };
}

describe("reportTestResult happy path", () => {
  it("closes the result with the agent's session", async () => {
    const { db, updates } = testDatabase(
      { sessionId: "44444444-4444-4444-8444-444444444444" },
      { id: "22222222-2222-4222-8222-222222222222" },
    );

    await reportTestResult(db, {
      id: "22222222-2222-4222-8222-222222222222",
      agentId: "agent-1",
      status: "passed",
      reason: "desktop visible",
    });

    assert.equal(updates.length, 1);
    assert.equal(updates[0].table, testResults);
    const values = updates[0].values as {
      status: string;
      reason: string;
      sessionId: string;
      finishedAt: unknown;
    };
    assert.deepEqual(
      { status: values.status, reason: values.reason, sessionId: values.sessionId },
      {
        status: "passed",
        reason: "desktop visible",
        sessionId: "44444444-4444-4444-8444-444444444444",
      },
    );
    assert.notEqual(values.finishedAt, undefined);
  });

  it("closes the result without a session when the agent has no run", async () => {
    const { db, updates } = testDatabase(undefined, { id: "22222222-2222-4222-8222-222222222222" });

    await reportTestResult(db, {
      id: "22222222-2222-4222-8222-222222222222",
      agentId: "agent-1",
      status: "failed",
    });

    const values = updates[0].values as { status: string; sessionId: string | undefined };
    assert.equal(values.status, "failed");
    assert.equal(values.sessionId, undefined);
  });
});

describe("reportTestResult unhappy path", () => {
  it("rejects an unknown result id", async () => {
    const { db, updates } = testDatabase({ sessionId: "44444444-4444-4444-8444-444444444444" });

    await assert.rejects(
      () =>
        reportTestResult(db, {
          id: "22222222-2222-4222-8222-222222222222",
          agentId: "agent-1",
          status: "passed",
        }),
      { message: "test-results: result 22222222-2222-4222-8222-222222222222 not found" },
    );
    assert.equal(updates.length, 1);
  });
});
