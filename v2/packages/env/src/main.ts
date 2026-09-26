import * as jarl from "jarl";
import * as Cli from "./cli.ts";
import * as Commands from "./commands.ts";
import * as Config from "./config.ts";
import * as Errors from "./errors.ts";
import * as Flags from "./flags.ts";
import * as Io from "./io.ts";
import * as Sources from "./sources.ts";
import * as Vars from "./vars.ts";

// Everything about the environment lives in this package: every variable, oligarchy.json, the env
// files and where they are read from, and the shape of a command line. An app hands in its flags,
// its commands and the names of the variables it needs, and gets back one typed object.

export {
  ConfigInvalid,
  FileMissing,
  FileUnreadable,
  HelpRequested,
  MissingVariable,
  Unexpected,
  UsageError,
} from "./errors.ts";
export type { Config } from "./config.ts";
export type { Io } from "./io.ts";
export type { Secret } from "./secret.ts";
export type { Source } from "./sources.ts";
export type { Name } from "./vars.ts";

export * as args from "./args.ts";

export const CONFIG_PATH = Config.PATH;

export const fakeIo = Io.fake;

export const command = Commands.command;

export const flag = {
  string: Cli.string,
  boolean: Cli.boolean,
  optional: Cli.optional,
  serverUrl: Flags.serverUrl,
};

export const source = {
  processEnv: Sources.processEnv,
  file: Sources.file,
  optionalFile: Sources.optionalFile,
  envFileFlag: Sources.envFileFlag,
  defaults: Sources.defaults,
};

export type App<F extends Cli.Spec, N extends Vars.Name, C extends Commands.Commands> = {
  readonly name: string;
  readonly description: string;
  // Flags every command takes; a command's own flags are declared on the command.
  readonly flags: F;
  readonly commands?: C;
  readonly needs: ReadonlyArray<N>;
  readonly sources?: ReadonlyArray<Sources.Source>;
};

// An app without commands has no `command` to switch on.
export type Env<F extends Cli.Spec, N extends Vars.Name, C extends Commands.Commands> = [
  keyof C,
] extends [never]
  ? { flags: Cli.Flags<F>; vars: Vars.Values<N>; config: Config.Config }
  : {
      command: Commands.Chosen<C>;
      flags: Cli.Flags<F>;
      vars: Vars.Values<N>;
      config: Config.Config;
    };

// Report order is fixed, so the same mistake always reads the same: help, the command, the rest of
// argv, then the env files, then the flags' variables, then oligarchy.json, then the app's
// variables. A test hands in its own io. The overload is the typed face: the body builds exactly
// the shape Env names for this app.
async function build<F extends Cli.Spec, N extends Vars.Name, C extends Commands.Commands = {}>(
  app: App<F, N, C>,
  io?: Io.Io,
): Promise<Env<F, N, C>>;
async function build(
  app: App<Cli.Spec, Vars.Name, Commands.Commands>,
  io: Io.Io = Io.node(),
): Promise<Record<string, unknown>> {
  const sources = app.sources ?? Sources.defaults;
  const commands = app.commands ?? {};
  const shared: Cli.Spec = Object.assign({}, ...sources.map((each) => each.flags), app.flags);

  if (io.argv.includes("--help")) {
    throw new Errors.HelpRequested(
      Commands.help(app.name, app.description, shared, commands, io.argv),
    );
  }

  const routed = await jarl.unwrap(Commands.route(io.argv, commands));
  const raw = await jarl.unwrap(Cli.tokenize(routed.rest, { ...shared, ...routed.flags }));

  // An earlier source wins. An empty value is unset, so a later source may still fill it.
  const vars: Record<string, string> = {};
  for (const each of sources) {
    for (const [key, value] of Object.entries(await jarl.unwrap(each.load(io, raw)))) {
      if (value !== "" && vars[key] === undefined) {
        vars[key] = value;
      }
    }
  }

  const flags = await jarl.unwrap(Cli.resolve(app.flags, raw, vars));
  const commandFlags = await jarl.unwrap(Cli.resolve(routed.flags, raw, vars));
  // Before the variables, so a broken file is never reported as a missing key.
  const config = await jarl.unwrap(Config.load(io));
  const values = await jarl.unwrap(Vars.resolve(app.needs, vars));
  const env = { flags, vars: values, config };
  return routed.name === undefined
    ? env
    : { command: { name: routed.name, flags: commandFlags }, ...env };
}

export const create = jarl.fn(
  build,
  Errors.keep(
    Errors.UsageError,
    Errors.HelpRequested,
    Errors.FileMissing,
    Errors.FileUnreadable,
    Errors.ConfigInvalid,
    Errors.MissingVariable,
  ),
);
