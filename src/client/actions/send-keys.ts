import { Argument } from "effect/unstable/cli";
import { postJSON } from "../http.ts";
import { type ClientArgs, parseClientArgs } from "../parse-args.ts";

const DEFAULT_ENCODING = "oligarchy";

const flags = {
  id: Argument.string("id"),
  keys: Argument.string("keys"),
  encoding: Argument.string("encoding").pipe(Argument.withDefault(DEFAULT_ENCODING)),
};

export type SendKeysArgs = ClientArgs<typeof flags>;

export async function sendKeysRun(argv: readonly string[]): Promise<void> {
  const args: SendKeysArgs = await parseClientArgs("send-keys", flags, argv);
  await postJSON(args, "/send-keys", { id: args.id, keys: args.keys, encoding: args.encoding, agent: args.agentId });
}
