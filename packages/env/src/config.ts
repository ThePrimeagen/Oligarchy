import {
  Config as EffectConfig,
  ConfigProvider,
  Context,
  Effect,
  FileSystem,
  Layer,
  Option,
  Redacted,
  Stdio,
} from "effect";
import * as Errors from "./errors.ts";

export const DEFAULT_SERVER_URL = "http://127.0.0.1:42069";
export const DEFAULT_LINEAR_API_URL = "https://api.linear.app/graphql";

// Every variable the fleet reads, in one place. The names are a type, so an environment built
// in code (`fromValues`, `override`) cannot name one that does not exist.
export const VARIABLES = [
  "OLIGARCHY_TOKEN",
  "OPENROUTER_API_KEY",
  "DATABASE_URL",
  "DATABASE_MIGRATION_URL",
  "AUTOMATION_SERVER_URL",
  "LINEAR_API_TOKEN",
  "LINEAR_TEAM",
  "LINEAR_API_URL",
  "LINEAR_WEBHOOK_SECRET",
  "SERVER_URL",
  "OLIGARCHY_DATA_DIR",
  "SESSION_ID",
] as const;
export type Variable = (typeof VARIABLES)[number];
export type Values = { readonly [Name in Variable]?: string };

const ENV_FILE = "--env-file";

// Last one wins, matching a repeated flag. `--` ends the scan, as it ends flags for the CLI.
const envFileArg = (args: ReadonlyArray<string>): Effect.Effect<Option.Option<string>> =>
  Effect.gen(function* () {
    let path: string | undefined;
    let missing = false;
    for (let index = 0; index < args.length; index++) {
      const arg = args[index];
      if (arg === undefined || arg === "--") {
        break;
      }
      if (arg === ENV_FILE) {
        const next = args[index + 1];
        if (next === undefined || next === "--" || next.startsWith("-")) {
          missing = true;
          path = undefined;
          continue;
        }
        path = next;
        missing = false;
        index += 1;
        continue;
      }
      if (arg.startsWith(`${ENV_FILE}=`)) {
        const value = arg.slice(ENV_FILE.length + 1);
        if (value === "") {
          missing = true;
          path = undefined;
        } else {
          path = value;
          missing = false;
        }
      }
    }
    if (missing) {
      return yield* Effect.die(new Error("--env-file needs a path"));
    }
    return Option.fromUndefinedOr(path);
  });

// The process environment first, then `--env-file` when one was passed, then `.env` when it
// exists. Each source fills only what the earlier ones left unset, so a variable already in
// the environment is never replaced by a file. The file is read from the process arguments
// here, before the CLI parses, because a flag that falls back to config has to see it. An
// unreadable `.env`, or an `--env-file` that was named and cannot be read, is a defect.
const chain: Effect.Effect<
  ConfigProvider.ConfigProvider,
  never,
  FileSystem.FileSystem | Stdio.Stdio
> = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const args = yield* (yield* Stdio.Stdio).args;
  let provider = ConfigProvider.fromEnv();
  const extra = yield* envFileArg(args);
  if (Option.isSome(extra)) {
    const file = yield* ConfigProvider.fromDotEnv({ path: extra.value }).pipe(Effect.orDie);
    provider = ConfigProvider.orElse(provider, file);
  }
  const hasDotEnv = yield* fs.exists(".env").pipe(Effect.orElseSucceed(() => false));
  if (!hasDotEnv) {
    return provider;
  }
  // A `.env` that exists but cannot be read is a broken working directory, not a missing variable.
  const dotEnv = yield* ConfigProvider.fromDotEnv({ path: ".env" }).pipe(Effect.orDie);
  return ConfigProvider.orElse(provider, dotEnv);
});

// What a process runs under.
export const live: Layer.Layer<never, never, FileSystem.FileSystem | Stdio.Stdio> =
  ConfigProvider.layer(chain);

// An explicit record and nothing else: a unit test's environment, or the dashboard's, which has
// no process to read. An empty string counts as absent, as `fromEnv` treats it.
export const fromValues = (values: Values): Layer.Layer<never> =>
  ConfigProvider.layer(ConfigProvider.fromEnv({ env: values }));

// The record ahead of the live chain: one variable points somewhere else (a local Postgres) and
// every other still comes from the process, the env file and `.env`.
export const override = (
  values: Values,
): Layer.Layer<never, never, FileSystem.FileSystem | Stdio.Stdio> =>
  ConfigProvider.layer(
    Effect.map(chain, (rest) =>
      ConfigProvider.orElse(ConfigProvider.fromEnv({ env: values }), rest),
    ),
  );

const missing = (name: string) => () => Errors.MissingVariable.make({ name });

export const required = (name: string): Effect.Effect<string, Errors.MissingVariable> =>
  EffectConfig.nonEmptyString(name).pipe(Effect.mapError(missing(name)));

// An empty value counts as missing, as `fromEnv` drops empty strings before the schema sees them.
export const requiredRedacted = (
  name: string,
): Effect.Effect<Redacted.Redacted, Errors.MissingVariable> =>
  EffectConfig.redacted(name).pipe(Effect.mapError(missing(name)));

export const oligarchyToken = requiredRedacted("OLIGARCHY_TOKEN");
// The harness talks to OpenRouter as itself. The token stays out of oligarchy.json.
export const openRouterToken = requiredRedacted("OPENROUTER_API_KEY");
export const databaseUrl = requiredRedacted("DATABASE_URL");
// `bun run db:migrate` only. Kept off DATABASE_URL so the app can use a pooler while
// migrations stay on a direct connection.
export const databaseMigrationUrl = requiredRedacted("DATABASE_MIGRATION_URL");
// The automation server viz sends its aborts to; read when a is pressed, so viz opens without it.
export const automationServerUrl = required("AUTOMATION_SERVER_URL");
export const linearApiToken = requiredRedacted("LINEAR_API_TOKEN");
// Which Linear team tickets are filed on. No default: a local process and production name
// different teams, and an empty value is unset.
export const linearTeam = required("LINEAR_TEAM");
// Sequential on purpose: LINEAR_API_TOKEN is reported before LINEAR_TEAM.
export const linearAccess = Effect.all({ token: linearApiToken, team: linearTeam });
// Unset in production. A test points the automation server at a stub that can hold a move.
export const linearApiUrl = EffectConfig.string("LINEAR_API_URL").pipe(
  Effect.orElseSucceed(() => DEFAULT_LINEAR_API_URL),
);
export const linearWebhookSecret = requiredRedacted("LINEAR_WEBHOOK_SECRET");

// For Flag.withFallbackConfig: SERVER_URL="" is unset and the flag's default applies.
export const serverUrl: EffectConfig.Config<string> = EffectConfig.string("SERVER_URL");

// For Flag.withFallbackConfig on qemu-server's --data-dir: where the iso cache and the minted
// disks live. OLIGARCHY_DATA_DIR="" is unset and the flag's default, ~/.oligarchy, applies.
export const dataDir: EffectConfig.Config<string> = EffectConfig.string("OLIGARCHY_DATA_DIR");

// For Flag.withFallbackConfig on ctrl's --session-id: SESSION_ID="" is unset and the flag's own
// rule applies, so a shell can `SESSION_ID=$(./ctrl session --search ...) && export SESSION_ID`
// once.
export const sessionId: EffectConfig.Config<string> = EffectConfig.string("SESSION_ID");

export class ProxyConfig extends Context.Service<ProxyConfig>()(
  "@oligarchy/env/config/ProxyConfig",
  {
    // Sequential on purpose: OLIGARCHY_TOKEN is reported before DATABASE_URL.
    make: Effect.all({ token: oligarchyToken, databaseUrl }),
  },
) {
  static readonly layer = Layer.effect(this)(this.make);
}
