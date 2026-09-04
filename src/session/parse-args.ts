import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { NodeServices } from "@effect/platform-node";
import { Config, Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";

const VERSION = "0.0.0";
const DEFAULT_SERVER_URL = "http://127.0.0.1:42069";

const flags = {
  serverUrl: Flag.string("server-url").pipe(
    Flag.withFallbackConfig(Config.string("SERVER_URL")),
    Flag.withDefault(DEFAULT_SERVER_URL),
    Flag.withDescription("Proxy URL, used as given; SERVER_URL when omitted"),
  ),
};

export function parseSessionArgs(argv: readonly string[]): Promise<{ serverUrl: string }> {
  if (existsSync(".env")) {
    loadEnvFile();
  }
  return Effect.runPromise(
    Effect.gen(function* () {
      let parsed: { serverUrl: string } | undefined;
      const command = Command.make("session", flags, (input) =>
        Effect.sync(() => {
          parsed = input;
        }),
      ).pipe(Command.withDescription("Drive one QEMU session interactively"));
      yield* Command.runWith(command, { version: VERSION })(argv);
      // --help and --version render and return without running the handler.
      if (parsed === undefined) {
        process.exit(0);
      }
      // The client children read it from the environment; fail here, before the first prompt.
      yield* Config.nonEmptyString("OLIGARCHY_TOKEN").pipe(Effect.mapError(() => new Error("OLIGARCHY_TOKEN is not set")));
      return { serverUrl: parsed.serverUrl };
    }).pipe(Effect.provide(NodeServices.layer)),
  );
}
