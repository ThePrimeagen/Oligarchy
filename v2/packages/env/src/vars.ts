import * as jarl from "jarl";
import * as Errors from "./errors.ts";
import * as Secret from "./secret.ts";
import type * as Sources from "./sources.ts";

type Var<T> = {
  readonly name: string;
  readonly read: (text: string) => T;
  readonly fallback: { readonly value: T } | undefined;
};

const required = (name: string): Var<string> => ({
  name,
  read: (text) => text,
  fallback: undefined,
});

const secret = (name: string): Var<Secret.Secret> => ({
  name,
  read: (text) => new Secret.Secret(text),
  fallback: undefined,
});

const withDefault = (name: string, value: string): Var<string> => ({
  name,
  read: (text) => text,
  fallback: { value },
});

// Every variable an oligarchy process reads, declared once. An app names the ones it needs, and
// only those are required.
export const all = {
  oligarchyToken: secret("OLIGARCHY_TOKEN"),
  // The harness talks to OpenRouter as itself. The token stays out of oligarchy.json.
  openRouterToken: secret("OPENROUTER_API_KEY"),
  databaseUrl: secret("DATABASE_URL"),
  // `db:migrate` only. Kept off DATABASE_URL so the app can use a pooler while migrations stay on
  // a direct connection.
  databaseMigrationUrl: secret("DATABASE_MIGRATION_URL"),
  automationServerUrl: required("AUTOMATION_SERVER_URL"),
  linearApiToken: secret("LINEAR_API_TOKEN"),
  // No default: a local process and production name different teams.
  linearTeam: required("LINEAR_TEAM"),
  // Unset in production. A test points the automation server at a stub.
  linearApiUrl: withDefault("LINEAR_API_URL", "https://api.linear.app/graphql"),
  linearWebhookSecret: secret("LINEAR_WEBHOOK_SECRET"),
};

export type Name = keyof typeof all;

export type Values<N extends Name> = {
  -readonly [K in N]: (typeof all)[K] extends Var<infer T> ? T : never;
};

// In the order the app names them, so the first variable reported is always the same one. The
// overload is the typed face: the body sets every named key with that variable's own type.
async function resolveValues<N extends Name>(
  names: ReadonlyArray<N>,
  vars: Sources.Vars,
): Promise<Values<N>>;
async function resolveValues(
  names: ReadonlyArray<Name>,
  vars: Sources.Vars,
): Promise<Record<string, unknown>> {
  const values: Record<string, unknown> = {};
  for (const name of names) {
    const variable: Var<unknown> = all[name];
    const text = vars[variable.name];
    if (text !== undefined) {
      values[name] = variable.read(text);
    } else if (variable.fallback !== undefined) {
      values[name] = variable.fallback.value;
    } else {
      throw new Errors.MissingVariable(variable.name);
    }
  }
  return values;
}

export const resolve = jarl.fn(resolveValues, Errors.keep(Errors.MissingVariable));
