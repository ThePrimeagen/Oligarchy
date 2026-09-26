import * as jarl from "jarl";
import type * as z from "zod";
import type * as Args from "./args.ts";
import * as Errors from "./errors.ts";
import type * as Vars from "./vars.ts";

// A command line is words, then flags: `ctrl test run one --name lock-screen`. The words name one
// command in the app's tree; after the first flag there is nothing but flags.

// Flags by camelCase key: `sessionId` is `--session-id` on the command line.
export type Spec = Readonly<Record<string, Args.Flag>>;

// zod's own test for "may this be absent": `.optional()` and `.default()` pass it.
type MayBeAbsent<S extends z.ZodType> = S extends { _zod: { optin: "optional" | "defaulted" } }
  ? true
  : false;

// What the program receives for one flag.
export type Value<F extends Args.Flag> = F["required"] extends true
  ? z.output<F["schema"]>
  : MayBeAbsent<F["schema"]> extends true
    ? z.output<F["schema"]>
    : z.output<F["schema"]> | undefined;

// One command. It takes its own flags and variables and those of every node above it; one with
// commands under it only routes to them.
export type Node = {
  readonly name: string;
  readonly description: string;
  readonly flags: Spec;
  readonly needs: ReadonlyArray<Vars.Name>;
  readonly commands: ReadonlyMap<string, Node>;
};

// argv as the user wrote it: the leading words, then each flag with what followed it, `true` when
// nothing but another flag or the end did.
export type Tokens = {
  readonly words: ReadonlyArray<string>;
  readonly flags: ReadonlyMap<string, string | true>;
};

export const flagName = (key: string): string =>
  key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

// Knows no app, which it does not need: with no positional arguments, whatever follows a flag and
// is not a flag is its value. A repeated flag keeps its last value.
export const tokenize = jarl.fn(async (argv: ReadonlyArray<string>): Promise<Tokens> => {
  const words: Array<string> = [];
  let index = 0;
  for (; index < argv.length && !(argv[index] ?? "").startsWith("-"); index++) {
    words.push(argv[index] ?? "");
  }
  const flags = new Map<string, string | true>();
  for (; index < argv.length; index++) {
    const arg = argv[index] ?? "";
    if (!arg.startsWith("--") || arg === "--") {
      throw new Errors.UsageError(`unexpected argument ${arg}`);
    }
    const equals = arg.indexOf("=");
    const name = equals === -1 ? arg.slice(2) : arg.slice(2, equals);
    const next = argv[index + 1];
    let value: string | true = true;
    if (equals !== -1) {
      value = arg.slice(equals + 1);
    } else if (next !== undefined && !next.startsWith("--")) {
      value = next;
      index += 1;
    }
    if (value === "") {
      throw new Errors.UsageError(`--${name} needs a value`);
    }
    flags.set(name, value);
  }
  return { words, flags };
}, Errors.keep(Errors.UsageError));

// The command the words name, with every flag and variable it takes from itself and above.
export type Found = {
  readonly command: string;
  readonly flags: Spec;
  readonly needs: ReadonlyArray<Vars.Name>;
};

const names = (node: Node): string => [...node.commands.keys()].join(", ");

export const find = jarl.fn(async (top: Node, words: ReadonlyArray<string>): Promise<Found> => {
  let node = top;
  const path: Array<string> = [];
  const flags: Record<string, Args.Flag> = { ...top.flags };
  const needs = [...top.needs];
  for (const word of words) {
    if (node.commands.size === 0) {
      throw new Errors.UsageError(`unexpected argument ${word}`);
    }
    const next = node.commands.get(word);
    if (next === undefined) {
      const typed = [...path, word].join(" ");
      throw new Errors.UsageError(`unknown command ${typed}; expected one of ${names(node)}`);
    }
    node = next;
    path.push(word);
    Object.assign(flags, node.flags);
    needs.push(...node.needs);
  }
  if (node.commands.size > 0) {
    throw new Errors.UsageError(
      path.length === 0
        ? `expected a command: ${names(node)}`
        : `${path.join(" ")} needs a command: ${names(node)}`,
    );
  }
  return { command: path.join(" "), flags, needs };
}, Errors.keep(Errors.UsageError));

// argv, else the flag's variable, else absent: a required flag refuses, any other is what its
// schema makes of nothing. `vars` holds only non-empty values. A flag argv sets that the spec
// lacks is refused before this, against every flag the command takes.
export const resolve = jarl.fn(
  async (
    spec: Spec,
    flags: Tokens["flags"],
    vars: Readonly<Record<string, string>>,
  ): Promise<Record<string, unknown>> => {
    const values: Record<string, unknown> = {};
    for (const [key, flag] of Object.entries(spec)) {
      const name = flagName(key);
      const given = flags.get(name);
      const fromEnv = flag.env === undefined ? undefined : vars[flag.env];
      let text: string;
      if (given === true) {
        text = "true";
      } else if (given !== undefined) {
        text = given;
      } else if (fromEnv !== undefined) {
        text = fromEnv;
      } else if (flag.required) {
        const or = flag.env === undefined ? "" : ` (or set ${flag.env})`;
        throw new Errors.UsageError(`--${name} is required${or}`);
      } else {
        const absent = flag.schema.safeParse(undefined);
        values[key] = absent.success ? absent.data : undefined;
        continue;
      }
      const decoded = flag.schema.safeParse(text);
      // A bare flag is a switch; anything else it names needs the value it was not given.
      if (given === true && (!decoded.success || typeof decoded.data !== "boolean")) {
        throw new Errors.UsageError(`--${name} needs a value`);
      }
      if (!decoded.success) {
        const from = given === undefined ? `${flag.env} (for --${name})` : `--${name}`;
        throw new Errors.UsageError(
          `${from}: ${decoded.error.issues[0]?.message ?? "invalid value"}`,
        );
      }
      values[key] = decoded.data;
    }
    return values;
  },
  Errors.keep(Errors.UsageError),
);

const table = (rows: ReadonlyArray<readonly [string, string]>): Array<string> => {
  const width = Math.max(...rows.map(([left]) => left.length));
  return rows.map(([left, right]) => `  ${left.padEnd(width)}  ${right}`);
};

const flagRow = ([key, flag]: [string, Args.Flag]): readonly [string, string] => {
  const bare = flag.schema.safeParse("true");
  const usage =
    bare.success && typeof bare.data === "boolean"
      ? `--${flagName(key)}`
      : `--${flagName(key)} <value>`;
  const absent = flag.required ? undefined : flag.schema.safeParse(undefined);
  const shown = absent?.success === true ? absent.data : undefined;
  const notes = [
    flag.env === undefined ? undefined : `env ${flag.env}`,
    flag.required ? "required" : undefined,
    typeof shown === "string" || typeof shown === "number" ? `default ${shown}` : undefined,
  ].filter((note) => note !== undefined);
  return [
    usage,
    notes.length === 0 ? flag.description : `${flag.description} (${notes.join(", ")})`,
  ];
};

// Help for the deepest command the words reach; a wrong word falls back to the level above it, so
// asking for help always answers.
export const help = (program: string, top: Node, shared: Spec, words: ReadonlyArray<string>) => {
  let node = top;
  const path = [program];
  const flags: Record<string, Args.Flag> = { ...shared, ...top.flags };
  for (const word of words) {
    const next = node.commands.get(word);
    if (next === undefined) {
      break;
    }
    node = next;
    path.push(word);
    Object.assign(flags, node.flags);
  }
  if (node.commands.size > 0) {
    const rows = [...node.commands.values()].map((each) => [each.name, each.description] as const);
    return [
      `usage: ${path.join(" ")} <command>`,
      "",
      node.description,
      "",
      ...table(rows),
      "",
    ].join("\n");
  }
  const rows = [...Object.entries(flags).map(flagRow), ["--help", "Show this help"] as const];
  return [`usage: ${path.join(" ")} [flags]`, "", node.description, "", ...table(rows), ""].join(
    "\n",
  );
};
