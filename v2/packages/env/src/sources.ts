import * as jarl from "jarl";
import * as Cli from "./cli.ts";
import * as Dotenv from "./dotenv.ts";
import * as Errors from "./errors.ts";
import type * as Io from "./io.ts";

export type Vars = Readonly<Record<string, string>>;

// One place variables come from. A source brings the flags it reads, so an app that leaves a
// source out also refuses its flag.
export type Source = {
  readonly flags: Cli.Spec;
  readonly load: (
    io: Io.Io,
    raw: Cli.Raw,
  ) => Promise<jarl.Result<Vars, Errors.FileMissing | Errors.FileUnreadable | Errors.Unexpected>>;
};

const readVars = jarl.fn(
  async (io: Io.Io, path: string): Promise<Vars> =>
    Dotenv.parse(await jarl.unwrap(io.readFile(path))),
  Errors.keep(Errors.FileMissing, Errors.FileUnreadable),
);

export const processEnv: Source = {
  flags: {},
  load: jarl.fn(async (io: Io.Io): Promise<Vars> => {
    const vars: Record<string, string> = {};
    for (const [key, value] of Object.entries(io.env)) {
      if (value !== undefined) {
        vars[key] = value;
      }
    }
    return vars;
  }, Errors.keep()),
};

// A file the app names must exist.
export const file = (path: string): Source => ({ flags: {}, load: (io) => readVars(io, path) });

// A file that may be absent; one that exists but cannot be read is still a failure.
export const optionalFile = (path: string): Source => ({
  flags: {},
  load: jarl.fn(async (io: Io.Io): Promise<Vars> => {
    const vars = await readVars(io, path);
    return jarl.error.is(vars, Errors.FileMissing) ? {} : jarl.unwrap(vars);
  }, Errors.keep(Errors.FileUnreadable)),
});

export const envFileFlag: Source = {
  flags: {
    envFile: Cli.optional(
      Cli.string({
        description:
          "Also read this env file: the process environment wins, then this file, then .env",
      }),
    ),
  },
  load: jarl.fn(
    async (io: Io.Io, raw: Cli.Raw): Promise<Vars> => {
      const path = raw.get("env-file");
      return path === undefined ? {} : jarl.unwrap(readVars(io, path));
    },
    Errors.keep(Errors.FileMissing, Errors.FileUnreadable),
  ),
};

// The process environment wins, then --env-file, then .env in the working directory.
export const defaults: ReadonlyArray<Source> = [processEnv, envFileFlag, optionalFile(".env")];
