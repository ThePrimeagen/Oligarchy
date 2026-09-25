import { readFile } from "node:fs/promises";
import * as jarl from "jarl";
import * as Errors from "./errors.ts";

// Everything env creation touches outside the process. Tests hand in a plain object instead.
export type Io = {
  readonly argv: ReadonlyArray<string>;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly readFile: (
    path: string,
  ) => Promise<jarl.Result<string, Errors.FileMissing | Errors.FileUnreadable>>;
};

const isNotFound = (cause: unknown): boolean =>
  cause instanceof Error && "code" in cause && cause.code === "ENOENT";

// For tests: argv, the environment and files handed in. A path in `unreadable` exists but refuses
// to open. `reads` says which files were asked for, in order.
export const fake = (
  options: {
    readonly argv?: ReadonlyArray<string>;
    readonly env?: Readonly<Record<string, string>>;
    readonly files?: Readonly<Record<string, string>>;
    readonly unreadable?: ReadonlyArray<string>;
  } = {},
): Io & { readonly reads: ReadonlyArray<string> } => {
  const reads: Array<string> = [];
  return {
    argv: options.argv ?? [],
    env: options.env ?? {},
    reads,
    readFile: async (path) => {
      reads.push(path);
      if (options.unreadable?.includes(path)) {
        return jarl.err(new Errors.FileUnreadable(path, new Error("EACCES: permission denied")));
      }
      const text = options.files?.[path];
      return text === undefined ? jarl.err(new Errors.FileMissing(path)) : jarl.ok(text);
    },
  };
};

export const node = (): Io => ({
  argv: process.argv.slice(2),
  env: process.env,
  readFile: jarl.fn(
    (path: string) => readFile(path, "utf8"),
    (cause, path) =>
      isNotFound(cause) ? new Errors.FileMissing(path) : new Errors.FileUnreadable(path, cause),
  ),
});
