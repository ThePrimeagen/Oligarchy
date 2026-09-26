import * as jarl from "jarl";
import * as App from "./app.ts";
import * as Cli from "./cli.ts";
import * as Config from "./config.ts";
import * as Errors from "./errors.ts";
import * as Io from "./io.ts";
import * as Sources from "./sources.ts";
import * as Vars from "./vars.ts";

// Everything about the environment lives in this package: every flag and variable, oligarchy.json,
// the env files and where they are read from, and the shape of a command line. An app declares its
// commands, their flags and the variables they need, and gets back the command that ran, typed.

export {
  ConfigInvalid,
  FileMissing,
  FileUnreadable,
  HelpRequested,
  MissingVariable,
  Unexpected,
  UsageError,
} from "./errors.ts";
export type { App, Command, Group, Run, Top } from "./app.ts";
export type { Config } from "./config.ts";
export type { Io } from "./io.ts";
export type { Secret } from "./secret.ts";
export type { Source } from "./sources.ts";
export type { Name } from "./vars.ts";

export * as args from "./args.ts";

export const CONFIG_PATH = Config.PATH;

export const fakeIo = Io.fake;

export const cli = App.cli;

export const source = {
  processEnv: Sources.processEnv,
  file: Sources.file,
  optionalFile: Sources.optionalFile,
  envFileFlag: Sources.envFileFlag,
  defaults: Sources.defaults,
};

// Report order is fixed, so the same mistake always reads the same: help, the words and flags as
// written, the command they name, the flags it does not take, the env files, the flags' values,
// oligarchy.json, then the variables the command needs. A test hands in its own io. The overload
// is the typed face: the body builds the member of `Out` the words name.
async function build<Out>(app: App.App<Out>, io?: Io.Io): Promise<Out>;
async function build(app: App.App<unknown>, io: Io.Io = Io.node()): Promise<unknown> {
  const shared: Cli.Spec = Object.assign({}, ...app.sources.map((each) => each.flags));

  if (io.argv.includes("--help")) {
    const firstFlag = io.argv.findIndex((arg) => arg.startsWith("-"));
    const words = io.argv.slice(0, firstFlag);
    throw new Errors.HelpRequested(Cli.help(app.name, app.top, shared, words));
  }

  const tokens = await jarl.unwrap(Cli.tokenize(io.argv));
  const found = await jarl.unwrap(Cli.find(app.top, tokens.words));
  const takes = new Set(Object.keys({ ...shared, ...found.flags }).map(Cli.flagName));
  for (const name of tokens.flags.keys()) {
    if (!takes.has(name)) {
      throw new Errors.UsageError(`unknown flag --${name}`);
    }
  }

  // An earlier source wins. An empty value is unset, so a later source may still fill it.
  const given = await jarl.unwrap(Cli.resolve(shared, tokens.flags, {}));
  const vars: Record<string, string> = {};
  for (const each of app.sources) {
    for (const [key, value] of Object.entries(await jarl.unwrap(each.load(io, given)))) {
      if (value !== "" && vars[key] === undefined) {
        vars[key] = value;
      }
    }
  }

  const flags = await jarl.unwrap(Cli.resolve(found.flags, tokens.flags, vars));
  // Before the variables, so a broken file is never reported as a missing key.
  const config = await jarl.unwrap(Config.load(io));
  const values = await jarl.unwrap(Vars.resolve(found.needs, vars));
  return { command: found.command, flags, vars: values, config };
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
