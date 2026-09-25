import * as jarl from "jarl";
import type * as z from "zod";
import * as Errors from "./errors.ts";

export type Flag<T> = {
  readonly kind: "string" | "boolean";
  readonly description: string;
  // The variable that sets the flag when argv does not.
  readonly env: string | undefined;
  readonly decode: (text: string) => jarl.Result<T, string>;
  // What the flag is when neither argv nor its variable sets it; undefined means it is required.
  readonly fallback: { readonly value: T } | undefined;
};

export type Spec = Readonly<Record<string, Flag<unknown>>>;

export type Flags<S extends Spec> = {
  -readonly [K in keyof S]: S[K] extends Flag<infer T> ? T : never;
};

// Values by flag name as argv spelled them, before any decoding: `--agent-id x` is `agent-id => x`.
export type Raw = ReadonlyMap<string, string>;

type Options<T> = {
  readonly description: string;
  readonly env?: string;
  readonly default?: T;
};

// The first issue is the one reported, as every other refusal here names one thing.
export const decodeWith =
  (schema: z.ZodType | undefined) =>
  (text: string): jarl.Result<unknown, string> => {
    if (schema === undefined) {
      return jarl.ok(text);
    }
    const parsed = schema.safeParse(text);
    return parsed.success
      ? jarl.ok(parsed.data)
      : jarl.err(parsed.error.issues[0]?.message ?? "invalid value");
  };

export function string(options: Options<string>): Flag<string>;
export function string<S extends z.ZodType>(
  options: Options<z.output<S>> & { readonly schema: S },
): Flag<z.output<S>>;
export function string(options: Options<unknown> & { readonly schema?: z.ZodType }): Flag<unknown> {
  return {
    kind: "string",
    description: options.description,
    env: options.env,
    decode: decodeWith(options.schema),
    fallback: "default" in options ? { value: options.default } : undefined,
  };
}

// A boolean is false unless something turns it on.
export const boolean = (options: Options<boolean>): Flag<boolean> => ({
  kind: "boolean",
  description: options.description,
  env: options.env,
  decode: (text) => {
    if (text === "true" || text === "1") {
      return jarl.ok(true);
    }
    if (text === "false" || text === "0") {
      return jarl.ok(false);
    }
    return jarl.err("must be true or false");
  },
  fallback: { value: options.default ?? false },
});

export const optional = <T>(flag: Flag<T>): Flag<T | undefined> => ({
  ...flag,
  fallback: { value: undefined },
});

const flagName = (key: string): string =>
  key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

export const tokenize = jarl.fn(async (argv: ReadonlyArray<string>, spec: Spec): Promise<Raw> => {
  const kinds = new Map(Object.entries(spec).map(([key, flag]) => [flagName(key), flag.kind]));
  const raw = new Map<string, string>();
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index] ?? "";
    if (!arg.startsWith("--") || arg === "--") {
      throw new Errors.UsageError(`unexpected argument ${arg}`);
    }
    const equals = arg.indexOf("=");
    const name = equals === -1 ? arg.slice(2) : arg.slice(2, equals);
    const kind = kinds.get(name);
    if (kind === undefined) {
      throw new Errors.UsageError(`unknown flag --${name}`);
    }
    let value: string | undefined;
    if (equals !== -1) {
      value = arg.slice(equals + 1);
    } else if (kind === "boolean") {
      value = "true";
    } else {
      const next = argv[index + 1];
      value = next?.startsWith("--") ? undefined : next;
      index += 1;
    }
    if (value === undefined || value === "") {
      throw new Errors.UsageError(`--${name} needs a value`);
    }
    raw.set(name, value);
  }
  return raw;
}, Errors.keep(Errors.UsageError));

// argv first, then the flag's variable, then its fallback. `vars` holds only non-empty values.
// The overload is the typed face: the body sets every key of the spec with that flag's own type.
async function resolveFlags<S extends Spec>(
  spec: S,
  raw: Raw,
  vars: Readonly<Record<string, string>>,
): Promise<Flags<S>>;
async function resolveFlags(
  spec: Spec,
  raw: Raw,
  vars: Readonly<Record<string, string>>,
): Promise<Record<string, unknown>> {
  const flags: Record<string, unknown> = {};
  for (const [key, flag] of Object.entries(spec)) {
    const name = flagName(key);
    const fromArgv = raw.get(name);
    const fromEnv = flag.env === undefined ? undefined : vars[flag.env];
    const text = fromArgv ?? fromEnv;
    if (text === undefined) {
      if (flag.fallback === undefined) {
        const or = flag.env === undefined ? "" : ` (or set ${flag.env})`;
        throw new Errors.UsageError(`--${name} is required${or}`);
      }
      flags[key] = flag.fallback.value;
      continue;
    }
    const decoded = flag.decode(text);
    if (!decoded.ok) {
      const from = fromArgv === undefined ? `${flag.env} (for --${name})` : `--${name}`;
      throw new Errors.UsageError(`${from}: ${decoded.error}`);
    }
    flags[key] = decoded.value;
  }
  return flags;
}

export const resolve = jarl.fn(resolveFlags, Errors.keep(Errors.UsageError));

export const help = (name: string, description: string, spec: Spec): string => {
  const rows = Object.entries(spec).map(([key, flag]) => {
    const usage = flag.kind === "boolean" ? `--${flagName(key)}` : `--${flagName(key)} <value>`;
    const shown = flag.kind === "string" ? flag.fallback?.value : undefined;
    const notes = [
      flag.env === undefined ? undefined : `env ${flag.env}`,
      flag.fallback === undefined ? "required" : undefined,
      typeof shown === "string" || typeof shown === "number"
        ? `default ${String(shown)}`
        : undefined,
    ].filter((note) => note !== undefined);
    return {
      usage,
      text: notes.length === 0 ? flag.description : `${flag.description} (${notes.join(", ")})`,
    };
  });
  rows.push({ usage: "--help", text: "Show this help" });
  const width = Math.max(...rows.map((row) => row.usage.length));
  const lines = rows.map((row) => `  ${row.usage.padEnd(width)}  ${row.text}`);
  return [`usage: ${name} [flags]`, "", description, "", ...lines, ""].join("\n");
};
