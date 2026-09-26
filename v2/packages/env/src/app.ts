import type * as Args from "./args.ts";
import type * as Cli from "./cli.ts";
import type * as Config from "./config.ts";
import * as Sources from "./sources.ts";
import type * as Vars from "./vars.ts";

// An app is a tree of commands built by chained calls: `cli` opens the app, `command` opens a
// command under the one open, and `done` closes it; the app closes with a `done` too, which hands
// back the finished App. Flags and variables go on a command before its first sub-command, and
// apply to it and every command under it.

// Above the app: closing the app finishes it.
export type Top = { readonly top: true };

// What the program receives when argv's words name this command.
export type Run<Path extends string, S extends Cli.Spec, N extends Vars.Name> = Path extends string
  ? {
      command: Path;
      flags: { -readonly [K in keyof S]: Cli.Value<S[K]> };
      vars: { -readonly [K in N]: Vars.Values<Vars.Name>[K] };
      config: Config.Config;
    }
  : never;

// A finished app: what `done` on the app returns, and the only thing `create` takes.
export type App<Out> = {
  readonly name: string;
  readonly description: string;
  readonly sources: ReadonlyArray<Sources.Source>;
  readonly top: Cli.Node;
  // Never set: it carries the union of every command that runs, for `create`.
  readonly runs?: Out;
};

type Join<Path extends string, K extends string> = Path extends "" ? K : `${Path} ${K}`;

// `done`: the finished app at the top, else the parent with this command's runs added.
type Close<Parent, O> = Parent extends Top
  ? App<O>
  : Parent extends Group<infer Path, infer S, infer N, infer Out, infer P>
    ? Group<Path, S, N, Out | O, P>
    : never;

// A key declared above becomes a compile error that names it. `help` is reserved.
type Unclaimed<F, S> = {
  readonly [K in keyof F & (keyof S | "help")]: `${K & string} is already a flag here`;
};

// A command's name is one word, not a flag, not a sibling's; otherwise a compile error says why.
type Word<Path extends string, K extends string, Out> = K extends
  | ""
  | `-${string}`
  | `${string} ${string}`
  ? "a command is one word that does not start with -"
  : [
        Extract<
          Out extends { command: infer C } ? C : never,
          Join<Path, K> | `${Join<Path, K>} ${string}`
        >,
      ] extends [never]
    ? K
    : `${Join<Path, K>} is already a command`;

// A command still taking its own flags and variables. `Path` is its words ("test run"; "" for the
// app), `S` every flag it takes, its own and every one above it, `N` likewise for variables,
// `Parent` what `done` goes back to.
export type Command<Path extends string, S extends Cli.Spec, N extends Vars.Name, Parent> = {
  flags<F extends Cli.Spec>(flags: F & Unclaimed<F, S>): Command<Path, S & F, N, Parent>;
  needs<M extends Vars.Name>(...names: ReadonlyArray<M>): Command<Path, S, N | M, Parent>;
  // From here on this command only routes, and takes no more flags or variables of its own.
  command<K extends string>(
    name: Word<Path, K, never>,
    description: string,
  ): Command<Join<Path, K>, S, N, Group<Path, S, N, never, Parent>>;
  // Closed without sub-commands, it is one the program runs.
  done(): Close<Parent, Run<Path, S, N>>;
};

// A command after its first sub-command. `Out` is every command under it that runs.
export type Group<Path extends string, S extends Cli.Spec, N extends Vars.Name, Out, Parent> = {
  command<K extends string>(
    name: Word<Path, K, Out>,
    description: string,
  ): Command<Join<Path, K>, S, N, Group<Path, S, N, Out, Parent>>;
  done(): Close<Parent, Out>;
};

type Building = {
  readonly name: string;
  readonly description: string;
  readonly flags: Record<string, Args.Flag>;
  readonly needs: Array<Vars.Name>;
  readonly commands: Map<string, Building>;
};

// One object serves a command before and after its first sub-command; the types above are what
// keep flags and needs off it once it routes.
const open = (node: Building, close: () => unknown) => {
  const self = {
    flags(flags: Cli.Spec) {
      Object.assign(node.flags, flags);
      return self;
    },
    needs(...names: ReadonlyArray<Vars.Name>) {
      node.needs.push(...names);
      return self;
    },
    command(name: string, description: string): unknown {
      const child: Building = { name, description, flags: {}, needs: [], commands: new Map() };
      node.commands.set(name, child);
      return open(child, () => self);
    },
    done: close,
  };
  return self;
};

// The overload is the typed face: the body builds the tree those types describe.
export function cli(options: {
  readonly name: string;
  readonly description: string;
  // First source wins. A source's flags are taken by every command.
  readonly sources?: ReadonlyArray<Sources.Source>;
}): Command<"", {}, never, Top>;
export function cli(options: {
  readonly name: string;
  readonly description: string;
  readonly sources?: ReadonlyArray<Sources.Source>;
}): unknown {
  const top: Building = {
    name: "",
    description: options.description,
    flags: {},
    needs: [],
    commands: new Map(),
  };
  const app: App<unknown> = {
    name: options.name,
    description: options.description,
    sources: options.sources ?? Sources.defaults,
    top,
  };
  return open(top, () => app);
}
