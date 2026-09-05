import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { NodeServices } from "@effect/platform-node";
import { Config, Effect, Schema } from "effect";
import { Command, Flag } from "effect/unstable/cli";

const VERSION = "0.0.0";

const HttpUrl = Schema.String.check(
  Schema.makeFilter(
    (value: string) => {
      if (!URL.canParse(value)) {
        return false;
      }
      const url = new URL(value);
      return (url.protocol === "http:" || url.protocol === "https:") && url.hostname !== "";
    },
    { message: "server-url must be a valid http or https url" },
  ),
);

// Declared by every action that talks about a proxy; test run does not, its driver reads
// the url from the ticket.
export const serverUrl = Flag.string("server-url").pipe(
  Flag.withFallbackConfig(Config.string("SERVER_URL")),
  Flag.withSchema(HttpUrl),
  Flag.withDescription("Oligarchy server URL; SERVER_URL when omitted"),
);

export type CtrlSpec = {
  env: Record<string, string>;
  flags: Command.Command.Config;
};

export type CtrlArgs<Spec extends CtrlSpec> = Command.Command.Config.Infer<Spec["flags"]> & {
  [Key in keyof Spec["env"]]: string;
} & {
  databaseUrl: string;
};

function envValue(variable: string): Effect.Effect<string, Error> {
  return Config.nonEmptyString(variable).pipe(Effect.mapError(() => new Error(`${variable} is not set`)));
}

// For a variable only one flag of an action needs: read it after parsing, when that flag is set.
export function requireEnv(variable: string): Promise<string> {
  return Effect.runPromise(envValue(variable));
}

export function parseCtrlArgs<const Env extends Record<string, string>, const Flags extends Command.Command.Config>(
  name: string,
  spec: { env: Env; flags: Flags },
  argv: readonly string[],
): Promise<CtrlArgs<{ env: Env; flags: Flags }>> {
  if (existsSync(".env")) {
    loadEnvFile();
  }
  return Effect.runPromise(
    Effect.gen(function* () {
      let parsed: Command.Command.Config.Infer<Flags> | undefined;
      const command = Command.make(name, spec.flags, (input) =>
        Effect.sync(() => {
          parsed = input;
        }),
      );
      yield* Command.runWith(command, { version: VERSION })(argv);
      // --help and --version render and return without running the handler.
      if (parsed === undefined) {
        process.exit(0);
      }
      const databaseUrl = yield* envValue("DATABASE_URL");
      const env: Record<string, string> = {};
      for (const [key, variable] of Object.entries(spec.env)) {
        env[key] = yield* envValue(variable);
      }
      return { ...parsed, ...env, databaseUrl } as CtrlArgs<{ env: Env; flags: Flags }>;
    }).pipe(Effect.provide(NodeServices.layer)),
  );
}
