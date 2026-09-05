import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { Option } from "effect";
import { Flag } from "effect/unstable/cli";
import { postStart } from "../http.ts";
import { type ClientArgs, parseClientArgs } from "../parse-args.ts";

const DEFAULT_ISO = "omarchy.iso";

const flags = {
  iso: Flag.string("iso").pipe(Flag.withDefault(DEFAULT_ISO), Flag.withDescription("ISO path or http(s) url")),
  disk: Flag.string("disk").pipe(Flag.optional, Flag.withDescription("Existing qcow2 path; omit for a fresh disk")),
};

export type StartArgs = ClientArgs<typeof flags>;

export async function startRun(argv: readonly string[]): Promise<void> {
  const args: StartArgs = await parseClientArgs("start", flags, argv);
  let iso = args.iso;
  if (!iso.startsWith("http://") && !iso.startsWith("https://")) {
    iso = resolve(iso);
    try {
      await stat(iso);
    } catch (err) {
      throw new Error(`iso: ${(err as Error).message}`);
    }
  }
  const out = JSON.parse(
    await postStart(args, {
      iso,
      // An undefined disk is left out of the JSON, so the server creates one.
      disk: Option.isNone(args.disk) ? undefined : resolve(args.disk.value),
      agent: args.agentId,
    }),
  ) as QemuStartResult;
  console.log(out.id);
}
