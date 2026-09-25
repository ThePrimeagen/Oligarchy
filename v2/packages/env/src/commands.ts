import * as jarl from "jarl";
import * as Cli from "./cli.ts";
import * as Errors from "./errors.ts";

// A command line is a verb, or a noun then a verb, then flags. Nouns and verbs come from fixed
// lists, and there is never a third word: `test run testsuite` is one operation, not three.

export type Command<S extends Cli.Spec> = {
  readonly kind: "command";
  readonly description: string;
  readonly flags: S;
};

// A noun holds verbs and nothing else, so a noun inside a noun does not type-check.
export type Noun = Readonly<Record<string, Command<Cli.Spec>>>;

export type Commands = Readonly<Record<string, Command<Cli.Spec> | Noun>>;

// The command that ran, named as it was typed, with its own flags.
export type Chosen<C extends Commands> = {
  [K in keyof C & string]: C[K] extends Command<infer S>
    ? { name: K; flags: Cli.Flags<S> }
    : {
        [V in keyof C[K] & string]: C[K][V] extends Command<infer S>
          ? { name: `${K} ${V}`; flags: Cli.Flags<S> }
          : never;
      }[keyof C[K] & string];
}[keyof C & string];

export function command(options: { readonly description: string }): Command<{}>;
export function command<S extends Cli.Spec>(options: {
  readonly description: string;
  readonly flags: S;
}): Command<S>;
export function command(options: {
  readonly description: string;
  readonly flags?: Cli.Spec;
}): Command<Cli.Spec> {
  return { kind: "command", description: options.description, flags: options.flags ?? {} };
}

const isCommand = (entry: Command<Cli.Spec> | Noun): entry is Command<Cli.Spec> =>
  entry.kind === "command";

// Own keys only, so `toString` is an unknown command rather than a prototype method.
const lookup = <T>(table: Readonly<Record<string, T>>, key: string | undefined): T | undefined =>
  key === undefined || key.startsWith("--") || !Object.hasOwn(table, key) ? undefined : table[key];

export type Routed = {
  // undefined for an app without commands.
  readonly name: string | undefined;
  readonly flags: Cli.Spec;
  readonly rest: ReadonlyArray<string>;
};

export const route = jarl.fn(
  async (argv: ReadonlyArray<string>, commands: Commands): Promise<Routed> => {
    const names = Object.keys(commands);
    if (names.length === 0) {
      return { name: undefined, flags: {}, rest: argv };
    }
    const first = argv[0];
    const entry = lookup(commands, first);
    if (first === undefined || first.startsWith("--")) {
      throw new Errors.UsageError(`expected a command: ${names.join(", ")}`);
    }
    if (entry === undefined) {
      throw new Errors.UsageError(`unknown command ${first}; expected one of ${names.join(", ")}`);
    }
    if (isCommand(entry)) {
      return { name: first, flags: entry.flags, rest: argv.slice(1) };
    }
    const verbs = Object.keys(entry).join(", ");
    const second = argv[1];
    const verb = lookup(entry, second);
    if (second === undefined || second.startsWith("--")) {
      throw new Errors.UsageError(`${first} needs a verb: ${verbs}`);
    }
    if (verb === undefined) {
      throw new Errors.UsageError(`unknown verb ${first} ${second}; expected one of ${verbs}`);
    }
    return { name: `${first} ${second}`, flags: verb.flags, rest: argv.slice(2) };
  },
  Errors.keep(Errors.UsageError),
);

const listing = (usage: string, description: string, rows: ReadonlyArray<[string, string]>) => {
  const width = Math.max(...rows.map(([name]) => name.length));
  const lines = rows.map(([name, text]) => `  ${name.padEnd(width)}  ${text}`);
  return [`usage: ${usage}`, "", description, "", ...lines, ""].join("\n");
};

// Help for the deepest level the path names; a wrong word falls back to the level above it, so
// asking for help always answers.
export const help = (
  name: string,
  description: string,
  shared: Cli.Spec,
  commands: Commands,
  argv: ReadonlyArray<string>,
): string => {
  if (Object.keys(commands).length === 0) {
    return Cli.help(name, description, shared);
  }
  const first = argv[0];
  const entry = lookup(commands, first);
  if (entry === undefined) {
    const rows = Object.entries(commands).map(([key, each]): [string, string] => [
      key,
      isCommand(each) ? each.description : Object.keys(each).join(", "),
    ]);
    return listing(`${name} <command>`, description, rows);
  }
  if (isCommand(entry)) {
    return Cli.help(`${name} ${String(first)}`, entry.description, { ...shared, ...entry.flags });
  }
  const second = argv[1];
  const verb = lookup(entry, second);
  if (verb === undefined) {
    const rows = Object.entries(entry).map(([key, each]): [string, string] => [
      key,
      each.description,
    ]);
    return listing(`${name} ${String(first)} <verb>`, description, rows);
  }
  return Cli.help(`${name} ${String(first)} ${String(second)}`, verb.description, {
    ...shared,
    ...verb.flags,
  });
};
