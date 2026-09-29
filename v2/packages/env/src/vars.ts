import * as jarl from "jarl";
import * as Errors from "./errors.ts";
import * as Secret from "./secret.ts";
import type * as Sources from "./sources.ts";

type Var<T> = {
  readonly name: string;
  readonly read: (text: string) => T;
};

const required = (name: string): Var<string> => ({
  name,
  read: (text) => text,
});

const secret = (name: string): Var<Secret.Secret> => ({
  name,
  read: (text) => new Secret.Secret(text),
});

// Every variable an oligarchy process reads, declared once. A command names the ones it needs,
// and only those are required.
export const all = {
  oligarchyToken: secret("OLIGARCHY_TOKEN"),
  // The harness talks to OpenRouter as itself. The token stays out of oligarchy.json.
  openRouterToken: secret("OPENROUTER_API_KEY"),
  databaseUrl: secret("DATABASE_URL"),
  // `db:migrate` only. Kept off DATABASE_URL so the programs can use a pooler while migrations
  // stay on a direct connection.
  databaseMigrationUrl: secret("DATABASE_MIGRATION_URL"),
  automationServerUrl: required("AUTOMATION_SERVER_URL"),
};

export type Name = keyof typeof all;

export type Values<N extends Name> = {
  -readonly [K in N]: (typeof all)[K] extends Var<infer T> ? T : never;
};

// In the order they are named, so the first variable reported is always the same one. The
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
    if (text === undefined) {
      throw new Errors.MissingVariable(variable.name);
    }
    values[name] = variable.read(text);
  }
  return values;
}

export const resolve = jarl.fn(resolveValues, Errors.keep(Errors.MissingVariable));
