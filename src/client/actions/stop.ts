import { Option, Schema } from "effect";
import { Flag } from "effect/unstable/cli";
import { postJSON } from "../http.ts";
import { type ClientArgs, parseClientArgs } from "../parse-args.ts";

const flags = {
  sessionId: Flag.string("session-id").pipe(Flag.withSchema(Schema.NonEmptyString), Flag.withDescription("Session id")),
  status: Flag.choice("status", ["succeeded", "failed", "aborted"]).pipe(Flag.optional, Flag.withDescription("Verdict; omit to abort")),
  reason: Flag.string("reason").pipe(Flag.optional, Flag.withDescription("Why the session ended")),
};

export type StopArgs = ClientArgs<typeof flags>;

export async function stopRun(argv: readonly string[]): Promise<void> {
  const args: StopArgs = await parseClientArgs("stop", flags, argv);
  const body: { id: string; agent: string; status?: string; reason?: string } = { id: args.sessionId, agent: args.agentId };
  if (Option.isSome(args.status)) {
    body.status = args.status.value;
  }
  if (Option.isSome(args.reason)) {
    body.reason = args.reason.value;
  }
  await postJSON(args, "/stop", body);
}
