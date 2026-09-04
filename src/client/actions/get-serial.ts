import { writeFile } from "node:fs/promises";
import { Option } from "effect";
import { Argument, Flag } from "effect/unstable/cli";
import { getBytes } from "../http.ts";
import { type ClientArgs, parseClientArgs } from "../parse-args.ts";

const flags = {
  output: Flag.string("output").pipe(Flag.withAlias("o"), Flag.optional, Flag.withDescription("Write the serial log here instead of stdout")),
  id: Argument.string("id"),
};

export type GetSerialArgs = ClientArgs<typeof flags>;

export async function getSerialRun(argv: readonly string[]): Promise<void> {
  const args: GetSerialArgs = await parseClientArgs("get-serial", flags, argv);
  const data = await getBytes(args, `/serial?id=${encodeURIComponent(args.id)}&agent=${encodeURIComponent(args.agentId)}`);
  if (Option.isSome(args.output)) {
    await writeFile(args.output.value, data, { mode: 0o644 });
    return;
  }
  await new Promise<void>((done, fail) => {
    process.stdout.write(data, (err) => (err ? fail(err) : done()));
  });
}
