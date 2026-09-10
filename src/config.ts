import {
  Config as EffectConfig,
  ConfigProvider,
  Context,
  Effect,
  FileSystem,
  Layer,
  Redacted,
} from "effect";
import * as Errors from "./shared/errors.ts";

export const DEFAULT_SERVER_URL = "http://127.0.0.1:42069";

// The environment first, then `.env` in the working directory when it exists: an already-set
// variable always wins over the file.
export const providerLayer: Layer.Layer<never, never, FileSystem.FileSystem> = ConfigProvider.layer(
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const env = ConfigProvider.fromEnv();
    const hasDotEnv = yield* fs.exists(".env").pipe(Effect.orElseSucceed(() => false));
    if (!hasDotEnv) {
      return env;
    }
    // A `.env` that exists but cannot be read is a broken working directory, not a missing variable.
    const dotEnv = yield* ConfigProvider.fromDotEnv({ path: ".env" }).pipe(Effect.orDie);
    return ConfigProvider.orElse(env, dotEnv);
  }),
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
export const databaseUrl = requiredRedacted("DATABASE_URL");
export const linearApiToken = requiredRedacted("LINEAR_API_TOKEN");
export const linearWebhookSecret = requiredRedacted("LINEAR_WEBHOOK_SECRET");

// For Flag.withFallbackConfig: SERVER_URL="" is unset and the flag's default applies.
export const serverUrl: EffectConfig.Config<string> = EffectConfig.string("SERVER_URL");

// For Flag.withFallbackConfig on ctrl's --session-id: SESSION_ID="" is unset and the flag's own
// rule applies, so a shell can `SESSION_ID=$(./ctrl session --search ...) && export SESSION_ID`
// once.
export const sessionId: EffectConfig.Config<string> = EffectConfig.string("SESSION_ID");

export class ProxyConfig extends Context.Service<ProxyConfig>()("@oligarchy/config/ProxyConfig", {
  // Sequential on purpose: OLIGARCHY_TOKEN is reported before DATABASE_URL.
  make: Effect.all({ token: oligarchyToken, databaseUrl }),
}) {
  static readonly layer = Layer.effect(this)(this.make);
}

export class AutomationConfig extends Context.Service<AutomationConfig>()("@oligarchy/config/AutomationConfig", {
  // Sequential on purpose: LINEAR_WEBHOOK_SECRET is reported before DATABASE_URL.
  make: Effect.all({ linearWebhookSecret, databaseUrl }),
}) {
  static readonly layer = Layer.effect(this)(this.make);
}
