import { Option } from "effect";
import { Argument } from "effect/unstable/cli";
import { postJSON } from "../http.ts";
import { type ClientArgs, parseClientArgs } from "../parse-args.ts";

const flags = {
  id: Argument.string("id"),
  status: Argument.choice("status", ["succeeded", "failed", "aborted"]).pipe(Argument.optional),
  reason: Argument.string("reason").pipe(Argument.optional),
};

export type StopArgs = ClientArgs<typeof flags>;

export async function stopRun(argv: readonly string[]): Promise<void> {
  const args: StopArgs = await parseClientArgs("stop", flags, argv);
  const body: { id: string; agent: string; status?: string; reason?: string } = { id: args.id, agent: args.agentId };
  if (Option.isSome(args.status)) {
    body.status = args.status.value;
  }
  if (Option.isSome(args.reason)) {
    body.reason = args.reason.value;
  }
  await postJSON(args, "/stop", body);
}
