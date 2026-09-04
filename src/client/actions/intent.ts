import { Schema } from "effect";
import { Flag } from "effect/unstable/cli";
import { postJSON } from "../http.ts";
import { type ClientArgs, parseClientArgs } from "../parse-args.ts";

const startFlags = {
  sessionId: Flag.string("session-id").pipe(Flag.withSchema(Schema.NonEmptyString), Flag.withDescription("Session id")),
  testResultId: Flag.string("test-result-id").pipe(
    Flag.withSchema(Schema.NonEmptyString),
    Flag.withDescription("Test result id from the Linear ticket"),
  ),
  message: Flag.string("message").pipe(Flag.withSchema(Schema.NonEmptyString), Flag.withDescription("What you are about to do")),
};

const endFlags = {
  sessionId: Flag.string("session-id").pipe(Flag.withSchema(Schema.NonEmptyString), Flag.withDescription("Session id")),
};

export type IntentStartArgs = ClientArgs<typeof startFlags>;
export type IntentEndArgs = ClientArgs<typeof endFlags>;

export function intentRun(argv: readonly string[]): Promise<void> {
  const [verb, ...rest] = argv;
  switch (verb) {
    case "start":
      return intentStartRun(rest);
    case "end":
      return intentEndRun(rest);
    default:
      throw new Error(`intent: expected start or end${verb === undefined ? "" : `, got ${verb}`}`);
  }
}

export async function intentStartRun(argv: readonly string[]): Promise<void> {
  const args: IntentStartArgs = await parseClientArgs("intent start", startFlags, argv);
  await postJSON(args, "/intent/start", {
    id: args.sessionId,
    agent: args.agentId,
    test_result_id: args.testResultId,
    message: args.message,
  });
}

export async function intentEndRun(argv: readonly string[]): Promise<void> {
  const args: IntentEndArgs = await parseClientArgs("intent end", endFlags, argv);
  await postJSON(args, "/intent/end", { id: args.sessionId, agent: args.agentId });
}
