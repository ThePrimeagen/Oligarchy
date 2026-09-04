import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { NodeServices } from "@effect/platform-node";
import { Config, Effect, Schema } from "effect";
import { Command, Flag } from "effect/unstable/cli";

const VERSION = "0.0.0";
const DEFAULT_SERVER_URL = "http://127.0.0.1:42069";

const shared = {
  agentId: Flag.string("agent-id").pipe(
    Flag.withSchema(Schema.NonEmptyString),
    Flag.withDescription("Calling agent's id"),
  ),
  serverUrl: Flag.string("server-url").pipe(
    Flag.withFallbackConfig(Config.string("SERVER_URL")),
    Flag.withDefault(DEFAULT_SERVER_URL),
    Flag.withDescription("Proxy URL, used as given; SERVER_URL when omitted"),
  ),
};

export type ClientArgs<Flags extends Command.Command.Config> = Command.Command.Config.Infer<Flags> & {
  agentId: string;
  serverUrl: string;
  token: string;
};

export function parseClientArgs<const Flags extends Command.Command.Config>(
  name: string,
  flags: Flags,
  argv: readonly string[],
): Promise<ClientArgs<Flags>> {
  if (existsSync(".env")) {
    loadEnvFile();
  }
  return Effect.runPromise(
    Effect.gen(function* () {
      let parsed: Command.Command.Config.Infer<typeof shared & Flags> | undefined;
      const command = Command.make(name, { ...shared, ...flags }, (input) =>
        Effect.sync(() => {
          parsed = input;
        }),
      );
      yield* Command.runWith(command, { version: VERSION })(argv);
      // --help and --version render and return without running the handler.
      if (parsed === undefined) {
        process.exit(0);
      }
      const token = yield* Config.nonEmptyString("OLIGARCHY_TOKEN").pipe(
        Effect.mapError(() => new Error("OLIGARCHY_TOKEN is not set")),
      );
      return { ...parsed, token } as ClientArgs<Flags>;
    }).pipe(Effect.provide(NodeServices.layer)),
  );
}
