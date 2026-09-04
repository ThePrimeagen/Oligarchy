import { Schema } from "effect";
import { Flag } from "effect/unstable/cli";
import { postJSON } from "../http.ts";
import { type ClientArgs, parseClientArgs } from "../parse-args.ts";

const DEFAULT_ENCODING = "oligarchy";

const flags = {
  sessionId: Flag.string("session-id").pipe(Flag.withSchema(Schema.NonEmptyString), Flag.withDescription("Session id")),
  keys: Flag.string("keys").pipe(Flag.withDescription("Key string to type, e.g. \"hello<ENTER>\"")),
  encoding: Flag.string("encoding").pipe(Flag.withDefault(DEFAULT_ENCODING), Flag.withDescription("Key string encoding")),
};

export type SendKeysArgs = ClientArgs<typeof flags>;

export async function sendKeysRun(argv: readonly string[]): Promise<void> {
  const args: SendKeysArgs = await parseClientArgs("send-keys", flags, argv);
  await postJSON(args, "/send-keys", { id: args.sessionId, keys: args.keys, encoding: args.encoding, agent: args.agentId });
}
