import { Schema } from "effect";
import { Flag } from "effect/unstable/cli";
import { getStream } from "../http.ts";
import { type ClientArgs, parseClientArgs } from "../parse-args.ts";

const flags = {
  sessionId: Flag.string("session-id").pipe(Flag.withSchema(Schema.NonEmptyString), Flag.withDescription("Session id")),
};

export type FollowArgs = ClientArgs<typeof flags>;

export async function followRun(argv: readonly string[]): Promise<void> {
  const args: FollowArgs = await parseClientArgs("follow", flags, argv);
  await getStream(args, `/follow?id=${encodeURIComponent(args.sessionId)}`, process.stdout);
}
