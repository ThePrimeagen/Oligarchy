import * as jarl from "jarl";

const messageOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

// A throw nobody planned for: a bug, or a library's own exception. It is still a result, so the
// entry decides what to print; the cause keeps the stack.
export class Unexpected extends jarl.error.define("Unexpected") {
  override readonly cause: unknown;
  constructor(cause: unknown) {
    super(`unexpected: ${messageOf(cause)}`);
    this.cause = cause;
  }
}

type Ctor<T> = abstract new (...args: never[]) => T;

// The mapError for every jarl.fn: the errors its body throws on purpose come back as themselves,
// and anything else becomes Unexpected, so no thrown value escapes as a rejection. An Unexpected
// from a step further down passes through unwrapped.
export const keep =
  <T extends ReadonlyArray<unknown>>(...expected: { readonly [K in keyof T]: Ctor<T[K]> }) =>
  (caught: unknown): T[number] | Unexpected => {
    if (caught instanceof Unexpected) {
      return caught;
    }
    for (const ctor of expected) {
      if (caught instanceof ctor) {
        return caught;
      }
    }
    return new Unexpected(caught);
  };

export class FileMissing extends jarl.error.define("FileMissing") {
  readonly path: string;
  constructor(path: string) {
    super(`${path}: file is missing`);
    this.path = path;
  }
}

export class FileUnreadable extends jarl.error.define("FileUnreadable") {
  readonly path: string;
  override readonly cause: unknown;
  constructor(path: string, cause: unknown) {
    super(`${path}: ${messageOf(cause)}`);
    this.path = path;
    this.cause = cause;
  }
}

// Anything wrong with argv. The message names the flag, so it is the whole report.
export class UsageError extends jarl.error.define("UsageError") {}

// Not a failure: the entry prints help and exits 0. It rides the error channel so nothing runs after it.
export class HelpRequested extends jarl.error.define("HelpRequested") {
  readonly text: string;
  constructor(text: string) {
    super("help requested");
    this.text = text;
  }
}

// The message never carries the value: a variable may be a secret.
export class MissingVariable extends jarl.error.define("MissingVariable") {
  readonly variable: string;
  constructor(variable: string) {
    super(`${variable} is not set`);
    this.variable = variable;
  }
}

export class ConfigInvalid extends jarl.error.define("ConfigInvalid") {
  readonly path: string;
  constructor(path: string, issue: string) {
    super(`${path}: ${issue}`);
    this.path = path;
  }
}
