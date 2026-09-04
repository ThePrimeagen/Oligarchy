import { eq, sql } from "drizzle-orm";
import { Option, Schema } from "effect";
import { Flag } from "effect/unstable/cli";
import { acquireAgentColor, flushLogs, log } from "../../db/log.ts";
import { closeDatabase, connectDatabase } from "../../db/ops.ts";
import { agentRuns, testResults } from "../../db/schema.ts";
import { type CtrlArgs, parseCtrlArgs } from "../parse-args.ts";

const spec = {
  env: {},
  flags: {
    agentId: Flag.string("agent-id").pipe(Flag.withSchema(Schema.NonEmptyString), Flag.withDescription("Calling agent's id")),
    id: Flag.string("id").pipe(Flag.withSchema(Schema.NonEmptyString), Flag.withDescription("Test result id")),
    status: Flag.choiceWithValue("status", [
      ["success", "passed"],
      ["failed", "failed"],
    ]).pipe(Flag.withDescription("Whether the test succeeded")),
    reason: Flag.string("reason").pipe(Flag.optional, Flag.withDescription("Why the test passed or failed")),
  },
};

export type TestResultsArgs = CtrlArgs<typeof spec>;

export async function testResultsRun(argv: readonly string[]): Promise<void> {
  const args: TestResultsArgs = await parseCtrlArgs("test-results", spec, argv);
  const reason = Option.getOrUndefined(args.reason);
  const db = connectDatabase(args.databaseUrl);
  try {
    const [agent] = await db
      .select({ sessionId: agentRuns.sessionId })
      .from(agentRuns)
      .where(eq(agentRuns.agentId, args.agentId));
    const [row] = await db
      .update(testResults)
      .set({
        status: args.status,
        reason,
        sessionId: agent?.sessionId,
        finishedAt: sql`now()`,
      })
      .where(eq(testResults.id, args.id))
      .returning({ id: testResults.id });
    if (row === undefined) {
      throw new Error(`test-results: result ${args.id} not found`);
    }
    acquireAgentColor(args.agentId);
    log(db, {
      text: `test result ${args.id}: ${args.status}${reason === undefined ? "" : `; ${reason}`}`,
      agentId: args.agentId,
      sessionId: agent?.sessionId,
    });
  } finally {
    await flushLogs();
    await closeDatabase(db);
  }
}
