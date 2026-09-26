# Jarl upgrade

Consult this table of contents first. Read only the section you need.

| Section |
|---------|
| [What this is](#what-this-is) |
| [The command line](#the-command-line) |
| [Where a flag's value comes from](#where-a-flags-value-comes-from) |
| [Refusals](#refusals) |
| [The application interface](#the-application-interface) |
| [Declaring an app](#declaring-an-app) |
| [What the program receives](#what-the-program-receives) |
| [Declarations](#declarations) |
| [Every flag](#every-flag) |
| [What does not compile](#what-does-not-compile) |

## What this is

`v2/` is the programs translated from Effect to jarl: plain async functions that return a
`jarl.Result` instead of an `Effect`. This document holds two interfaces agreed for it: the command
line every program reads, and the application interface `@oligarchy/env` gives a program to declare
its commands, flags and variables.

Built: `v2/packages/env/src/args.ts`, every flag any program takes, exported as `Env.args` (#253).
Not built yet: the builder and the parser below. `v2/packages/env/src/cli.ts` and `commands.ts`
still read the old noun-then-verb shape; the parser replaces them, and `Env.command`,
`Env.flag.*`, `flags.ts` and the `App` object literal go with them.

## The command line

```
program [word ...] [--flag value | --flag=value | --flag] ...
```

- Every argument before the first one starting with `-` is a word. The words name one command in
  the app's tree, one word per level, as deep as the tree goes: `ctrl test run one`.
- Only a command with no sub-commands runs. A command with sub-commands only routes: the words must
  go on to one of them.
- An app with no commands is itself the command that runs, and takes no words: `driver --action
  mint ...`.
- After the first flag there are only flags. There are no positional arguments, and a word never
  follows a flag: `ctrl test --name x run` is refused.
- A flag is `--` and its key in kebab-case: the key `sessionId` is `--session-id`. There are no
  single-dash or short flags, and `--` alone is refused.
- `--flag value` and `--flag=value` give the flag that text; the value is the next argument unless
  that one starts with `--`. A bare `--flag` (followed by another flag or by nothing) is `"true"`, so
  only a flag whose schema turns `"true"` into a boolean may stand bare. An empty value is refused.
- A repeated flag keeps its last value.
- A flag declared on a command belongs to it and to every command under it. A command takes its own
  flags, every flag of every command above it, and the flags of the app's variable sources
  (`--env-file`). A flag of a sibling or of a command below is unknown.
- `--help` anywhere prints help for the deepest command the words reach, a wrong word falling back to
  the level above it, and runs nothing.

## Where a flag's value comes from

1. argv: the text after the flag, or `"true"` for a bare flag.
2. Else the flag's variable, when it names one. An empty variable is unset.
3. Else the flag is absent. A required flag refuses the command line. One that is not required is
   what its schema makes of nothing: `.default(x)` is x, `.optional()` is undefined, and any other
   schema is undefined without being run.

The text goes through the flag's zod schema; the schema's output is what the program receives, and
its first issue is what a refusal reports.

## Refusals

Each refusal names one thing, and the same mistake always reads the same, because they are checked in
this order:

1. `--help` anywhere. Help, not a failure.
2. The words and the flags, read without the app:
   `unexpected argument run` (a word after a flag, `-x`, `--`), `--x needs a value` (an empty value).
3. The command the words name:
   `expected a command: mint, test` (no words), `unknown command test fly; expected one of define,
   run`, `test run needs a command: one, suite` (the words stop on a command that routes),
   `unexpected argument testsuite` (a word past a command that runs).
4. The flags against that command:
   `unknown flag --name`, then for each flag in the order it was declared, top-down:
   `--iso needs a value` (bare, not a boolean), `--session-id is required (or set SESSION_ID)`,
   `--count: must be at least 1` (the schema refused argv), `SESSION_ID (for --session-id): ...`
   (the schema refused the variable).
5. The env files, oligarchy.json, then the variables the command needs: `.prod-env: file is
   missing`, `oligarchy.json: ...`, `OPENROUTER_API_KEY is not set`.

```
ctrl test --name x run                       unexpected argument run
ctrl test                                    test needs a command: define, run
ctrl mint --name x                           unknown flag --name
ctrl test run one --iso --version 2026.09.1  --iso needs a value
```

## The application interface

An app is a tree of commands built by chained calls. `Env.cli` opens the app, `.command(name,
description)` opens a command under the one open, and `.done()` closes it; the app itself is closed
by a `.done()` too, which hands back the finished `App`. `.flags({...})` and `.needs(...)` go on a
command before its first sub-command, and apply to it and every command under it. `Env.create(app)`
reads argv, the variable sources and oligarchy.json, and hands back the command that ran, typed.

## Declaring an app

Flags come from `Env.args`, one call each: called with nothing a flag is required, called with
`false` it is not.

```ts
export const ctrl = Env.cli({ name: "ctrl", description: "Record and inspect test runs" })
  .flags({ serverUrl: Env.args.serverUrl(false), sessionId: Env.args.sessionId(false) })
  .needs("databaseUrl")
  .command("mint", "Mint the ISO on every live qemu server")
    .flags({ iso: Env.args.iso(), unminted: Env.args.unminted(false) })
    .needs("linearApiToken", "linearTeam")
  .done()
  .command("test", "Test definitions and their runs")
    .command("define", "Define a test, or a new wording of one")
      .flags({
        name: Env.args.definitionName(),
        description: Env.args.testDescription(false),
        instruction: Env.args.instruction(false),
        proof: Env.args.proof(false),
      })
    .done()
    .command("run", "File runs and their Linear tickets")
      .flags({ iso: Env.args.iso(), version: Env.args.version() })
      .needs("linearApiToken", "linearTeam")
      .command("one", "File a run of one definition")
        .flags({ name: Env.args.definitionName() })
      .done()
      .command("suite", "File a run of every definition but mint")
      .done()
    .done()
  .done()
  .command("test-results", "Close a test result with its verdict")
    .flags({
      agentId: Env.args.agentId(),
      id: Env.args.id(),
      status: Env.args.resultStatus(),
      reason: Env.args.reason(false),
    })
  .done()
  .done();

export const driver = Env.cli({ name: "driver", description: "Run the harness loop for one prompt" })
  .flags({
    action: Env.args.action(),
    prompt: Env.args.prompt(),
    agentId: Env.args.agentId(),
    debugLog: Env.args.debugLog(false),
    serverUrl: Env.args.serverUrl(false),
  })
  .needs("openRouterToken", "databaseUrl")
  .done();
```

## What the program receives

`jarl.unwrap(await Env.create(ctrl))` is one member per command that runs, each with every flag it
takes, its own and inherited, resolved to values; the variables it needs; and oligarchy.json. A
`switch (env.command)` narrows to exactly one. This is what tsc prints for the app above:

```ts
  | { command: "mint";
      flags: { serverUrl: string; sessionId: string | undefined; iso: string; unminted: boolean };
      vars: { databaseUrl: Secret; linearApiToken: Secret; linearTeam: string }; config: Config }
  | { command: "test define";
      flags: { serverUrl: string; sessionId: string | undefined; name: string;
               description: string | undefined; instruction: string | undefined; proof: string | undefined };
      vars: { databaseUrl: Secret }; config: Config }
  | { command: "test run one";
      flags: { serverUrl: string; sessionId: string | undefined; iso: string; version: string; name: string };
      vars: { databaseUrl: Secret; linearApiToken: Secret; linearTeam: string }; config: Config }
  | { command: "test run suite";
      flags: { serverUrl: string; sessionId: string | undefined; iso: string; version: string };
      vars: { databaseUrl: Secret; linearApiToken: Secret; linearTeam: string }; config: Config }
  | { command: "test-results";
      flags: { serverUrl: string; sessionId: string | undefined; agentId: string; id: string;
               status: "passed" | "failed"; reason: string | undefined };
      vars: { databaseUrl: Secret }; config: Config }
```

The driver has no commands, so it receives one member, `command: ""`:
`{ command: ""; flags: { action: "drive" | "mint"; prompt: string; agentId: string; debugLog: string
| undefined; serverUrl: string }; vars: { databaseUrl: Secret; openRouterToken: Secret }; config:
Config }`.

## Declarations

`@oligarchy/env`'s interface once the parser is built. Types from dependencies keep their own names
and stay opaque: `jarl.Result<T, E>` is `{ ok: true; value: T } | { ok: false; error: E }`,
`z.ZodType` is a zod schema and `z.output<S>` what it decodes to.

```ts
// ---------------------------------------------------------------------------
// Flags: v2/packages/env/src/args.ts
// ---------------------------------------------------------------------------

/** One `--kebab-case` flag, keyed in camelCase: `sessionId` is `--session-id`. */
export type Flag<S extends z.ZodType = z.ZodType, R extends boolean = boolean> = {
  /** Decodes the text. A bare `--flag` is "true" and must decode to a boolean. */
  readonly schema: S;
  readonly description: string;
  /** Read when argv does not set the flag. */
  readonly env?: string;
  /** Absent from argv and its variable, a required flag refuses the command line; one that is not
   *  required is what its schema makes of nothing: `.default(x)` is x, anything else undefined. */
  readonly required: R;
};

/** The type of every export of `args`; the code does not name it. `required` stays the literal
 *  it was given, so the type of the value a command receives can follow it. */
type FlagFn<S extends z.ZodType> = {
  (required?: true): Flag<S, true>;
  (required: false): Flag<S, false>;
};

type ArgName =
  | "envFile" | "serverUrl" | "agentId" | "sessionId" | "testResultId"
  | "port" | "machineName" | "url" | "maxJobs" | "display" | "automation" | "dataDir"
  | "action" | "prompt" | "debugLog"
  | "output" | "imageId"
  | "list" | "details" | "history" | "definitionName" | "testDescription" | "instruction" | "proof"
  | "iso" | "version" | "unminted" | "model" | "id" | "resultStatus" | "reason" | "count"
  | "active" | "json" | "search" | "sessionStatus" | "logs" | "testDef" | "testResults" | "testRun"
  | "actions" | "images" | "debugLogs" | "diagnosis" | "all"
  | "key" | "errorTypeDescription" | "verdict" | "type" | "summary";

/** Every flag any program takes. Each export keeps its own schema type in place of z.ZodType:
 *  see "Every flag". */
export declare const args: { readonly [K in ArgName]: FlagFn<z.ZodType> };

export type Spec = Readonly<Record<string, Flag>>;

/** zod's own test for "may this be absent": `.optional()` and `.default()` pass it. */
export type MayBeAbsent<S extends z.ZodType> = S extends { _zod: { optin: "optional" | "defaulted" } }
  ? true
  : false;

/** What the program receives for one flag. */
export type Value<F extends Flag> = F["required"] extends true
  ? z.output<F["schema"]>
  : MayBeAbsent<F["schema"]> extends true
    ? z.output<F["schema"]>
    : z.output<F["schema"]> | undefined;

// ---------------------------------------------------------------------------
// Declaring an app
// ---------------------------------------------------------------------------

/** Open an app. It is itself a command, the one with no words: it runs when it has no
 *  sub-commands, and routes to them when it has some. */
export declare function cli(options: {
  readonly name: string;
  readonly description: string;
  /** First source wins. Defaults to source.defaults. A source's flags are taken by every command. */
  readonly sources?: ReadonlyArray<Source>;
}): Command<"", {}, never, Top>;

/** A command still taking its own flags and variables. `Path` is its words ("test run"; "" for the
 *  app), `S` every flag it takes, its own and every one above it, `N` likewise for variables,
 *  `Parent` what `done()` goes back to. */
export interface Command<Path extends string, S extends Spec, N extends Name, Parent> {
  /** Taken by this command and every command under it. A key declared above is a compile error. */
  flags<F extends Spec>(flags: F & Unclaimed<F, S>): Command<Path, S & F, N, Parent>;
  /** Needed by this command and every command under it. */
  needs<M extends Name>(...names: ReadonlyArray<M>): Command<Path, S, N | M, Parent>;
  /** Open a sub-command. From here on this command only routes, and takes no more flags or
   *  variables of its own. */
  command<K extends string>(
    name: Word<Path, K, never>,
    description: string,
  ): Command<Join<Path, K>, S, N, Group<Path, S, N, never, Parent>>;
  /** Close this command. Closed without sub-commands, it is one the program runs. */
  done(): Close<Parent, Run<Path, S, N>>;
}

/** A command after its first sub-command. `Out` is every command under it that runs. */
export interface Group<Path extends string, S extends Spec, N extends Name, Out, Parent> {
  command<K extends string>(
    name: Word<Path, K, Out>,
    description: string,
  ): Command<Join<Path, K>, S, N, Group<Path, S, N, Out, Parent>>;
  /** Close this command; every command under it that runs is its parent's too. */
  done(): Close<Parent, Out>;
}

/** Above the app: closing the app finishes it. */
export interface Top {
  readonly top: true;
}

/** What the program receives when argv's words name this command. */
export type Run<Path extends string, S extends Spec, N extends Name> = Path extends string
  ? {
      command: Path;
      flags: { -readonly [K in keyof S]: Value<S[K]> };
      vars: { -readonly [K in N]: Variables[K] };
      config: Config;
    }
  : never;

/** A finished app: what `done()` on the app returns, and the only thing `create` takes. */
export interface App<Out> {
  readonly name: string;
  readonly description: string;
  readonly sources: ReadonlyArray<Source>;
  readonly top: Node;
  /** Never set: it carries the union of every command that runs, for `create`. */
  readonly runs?: Out;
}

/** One command at runtime. `commands` is empty for a command that runs. */
export interface Node {
  readonly name: string;
  readonly description: string;
  /** Its own; it also takes every flag of every node above it. */
  readonly flags: Spec;
  readonly needs: ReadonlyArray<Name>;
  readonly commands: ReadonlyMap<string, Node>;
}

export type Join<Path extends string, K extends string> = Path extends "" ? K : `${Path} ${K}`;

/** `done()`: the finished app at the top, else the parent with this command's runs added. */
export type Close<Parent, O> = Parent extends Top
  ? App<O>
  : Parent extends Group<infer Path, infer S, infer N, infer Out, infer P>
    ? Group<Path, S, N, Out | O, P>
    : never;

/** A key already declared above becomes a compile error that names it. `help` is reserved. */
export type Unclaimed<F, S> = {
  readonly [K in keyof F & (keyof S | "help")]: `${K & string} is already a flag here`;
};

/** A command's name is one word, not a flag, not a sibling's. Otherwise a compile error says why. */
export type Word<Path extends string, K extends string, Out> = K extends
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

/** Read argv against the app, in the order "Refusals" gives. A test hands in its own io. */
export declare function create<Out>(
  app: App<Out>,
  io?: Io,
): Promise<
  jarl.Result<
    Out,
    | UsageError
    | HelpRequested
    | FileMissing
    | FileUnreadable
    | ConfigInvalid
    | MissingVariable
    | Unexpected
  >
>;

// ---------------------------------------------------------------------------
// The parser, inside the package: v2/packages/env/src/cli.ts
// ---------------------------------------------------------------------------

/** argv as the user wrote it: the leading words, then each --flag with what followed it. */
export interface Tokens {
  readonly words: ReadonlyArray<string>;
  /** kebab-case name to its value; `true` when nothing but another flag or the end followed it. */
  readonly flags: ReadonlyMap<string, string | true>;
}

/** Knows no app. */
export declare const tokenize: (
  argv: ReadonlyArray<string>,
) => Promise<jarl.Result<Tokens, UsageError | Unexpected>>;

/** The command the words name, with every flag and variable it takes from itself and above. */
export interface Found {
  readonly command: string;
  readonly flags: Spec;
  readonly needs: ReadonlyArray<Name>;
}

export declare const find: (
  app: App<unknown>,
  words: ReadonlyArray<string>,
) => Promise<jarl.Result<Found, UsageError | Unexpected>>;

/** Refuses a flag the spec lacks, then reads each from argv, else its variable, else absent. */
export declare const resolve: (
  spec: Spec,
  flags: Tokens["flags"],
  vars: Readonly<Record<string, string>>,
) => Promise<jarl.Result<Record<string, unknown>, UsageError | Unexpected>>;

/** Help for the deepest command the words reach; a wrong word falls back to the one above. */
export declare const help: (app: App<unknown>, words: ReadonlyArray<string>) => string;

// ---------------------------------------------------------------------------
// Unchanged from today's package
// ---------------------------------------------------------------------------

/** Anything wrong with argv. The message names the flag, so it is the whole report. */
export declare class UsageError extends Error {}
/** Not a failure: the entry prints `text` and exits 0. */
export declare class HelpRequested extends Error {
  readonly text: string;
}
export declare class FileMissing extends Error {
  readonly path: string;
}
export declare class FileUnreadable extends Error {
  readonly path: string;
}
export declare class ConfigInvalid extends Error {
  readonly path: string;
}
/** The message never carries a value: a variable may be a secret. */
export declare class MissingVariable extends Error {
  readonly variable: string;
}
/** A throw nobody planned for; `cause` keeps the stack. */
export declare class Unexpected extends Error {}

/** Prints as [redacted]. */
export declare class Secret {
  reveal(): string;
}

/** Every variable an oligarchy process reads, by the key a command asks for it with. */
export type Variables = {
  oligarchyToken: Secret; // OLIGARCHY_TOKEN
  openRouterToken: Secret; // OPENROUTER_API_KEY
  databaseUrl: Secret; // DATABASE_URL
  databaseMigrationUrl: Secret; // DATABASE_MIGRATION_URL
  automationServerUrl: string; // AUTOMATION_SERVER_URL
  linearApiToken: Secret; // LINEAR_API_TOKEN
  linearTeam: string; // LINEAR_TEAM
  linearApiUrl: string; // LINEAR_API_URL, default https://api.linear.app/graphql
  linearWebhookSecret: Secret; // LINEAR_WEBHOOK_SECRET
};
export type Name = keyof Variables;

export type Effort = "minimal" | "low" | "medium" | "high" | "xhigh";

/** oligarchy.json, decoded; durations in milliseconds. */
export type Config = {
  models: { drive: string; diagnose: string; mint: string };
  reasoning: { drive: Effort; diagnose: Effort; mint: Effort };
  openRouterBaseUrl: string;
  timeouts: { header: number; chunk: number };
  runCeiling: number;
  stepLimit: number;
  harness: { defaultRetry: number };
};

export declare const CONFIG_PATH: string;

/** Everything create touches outside the process. */
export type Io = {
  readonly argv: ReadonlyArray<string>;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly readFile: (path: string) => Promise<jarl.Result<string, FileMissing | FileUnreadable>>;
};

/** For tests: argv, the environment and files handed in; `reads` says which files were asked for. */
export declare const fakeIo: (options?: {
  readonly argv?: ReadonlyArray<string>;
  readonly env?: Readonly<Record<string, string>>;
  readonly files?: Readonly<Record<string, string>>;
  readonly unreadable?: ReadonlyArray<string>;
}) => Io & { readonly reads: ReadonlyArray<string> };

/** One place variables come from. A source brings the flags it reads, so an app that leaves the
 *  source out also refuses its flag. */
export type Source = {
  readonly flags: Spec;
  readonly load: (
    io: Io,
    flags: Tokens["flags"],
  ) => Promise<jarl.Result<Readonly<Record<string, string>>, FileMissing | FileUnreadable | Unexpected>>;
};

export declare const source: {
  processEnv: Source;
  /** A file that must exist. */
  file(path: string): Source;
  /** A file that may be absent; one that exists but cannot be read is still a failure. */
  optionalFile(path: string): Source;
  /** `--env-file <path>`. */
  envFileFlag: Source;
  /** The process environment wins, then --env-file, then .env in the working directory. */
  defaults: ReadonlyArray<Source>;
};
```

## Every flag

`Env.args`, from `v2/packages/env/src/args.ts`. An export is named for its key and its key is its
spelling. Where one spelling means different things in different commands, each meaning has an
export of its own and the command keys it by the spelling: `name: Env.args.machineName()`,
`status: Env.args.resultStatus()`. A default applies only to a flag that is not required. Only
`client` took flags missing here; it is going away.

| Export | Spelling | Value | Variable | Default |
|---|---|---|---|---|
| `envFile` | `--env-file` | path | | |
| `serverUrl` | `--server-url` | http(s) url, as given | `SERVER_URL` | `http://127.0.0.1:42069` |
| `agentId` | `--agent-id` | the calling agent's Linear ticket | | |
| `sessionId` | `--session-id` | session id | `SESSION_ID` | |
| `testResultId` | `--test-result-id` | test result id | | |
| `port` | `--port` | integer, 1..65535 | | none: each server has its own |
| `machineName` | `--name` | this machine's name on the fleet | | |
| `url` | `--url` | http(s) url the fleet reaches this machine at | | |
| `maxJobs` | `--max-jobs` | integer, at least 1 | | |
| `display` | `--display` | `none`, `gtk`, `sdl`, `egl-headless`, `spice-app`, `dbus` | | |
| `automation` | `--automation` | boolean | | `false` |
| `dataDir` | `--data-dir` | directory | `OLIGARCHY_DATA_DIR` | `~/.oligarchy` |
| `action` | `--action` | `drive`, `mint` | | |
| `prompt` | `--prompt` | text | | |
| `debugLog` | `--debug-log` | path | | |
| `output` | `--output` | path | | |
| `imageId` | `--image-id` | image id | | |
| `list` | `--list` | boolean | | `false` |
| `details` | `--details` | boolean | | `false` |
| `history` | `--history` | boolean | | `false` |
| `definitionName` | `--name` | test definition name | | |
| `testDescription` | `--description` | what the test is about | | |
| `instruction` | `--instruction` | text | | |
| `proof` | `--proof` | text | | |
| `iso` | `--iso` | https url | | |
| `version` | `--version` | version label | | |
| `unminted` | `--unminted` | boolean | | `false` |
| `model` | `--model` | Cursor model id | | |
| `id` | `--id` | test result id | | |
| `resultStatus` | `--status` | `success` read as `passed`, `failed` | | |
| `reason` | `--reason` | text | | |
| `count` | `--count` | integer, at least 1 | | `10` |
| `active`, `json`, `search` | `--active`, `--json`, `--search` | boolean | | `false` |
| `sessionStatus` | `--status` | boolean | | `false` |
| `logs`, `testDef`, `testResults`, `testRun` | `--logs`, `--test-def`, `--test-results`, `--test-run` | boolean | | `false` |
| `actions`, `images`, `debugLogs`, `diagnosis`, `all` | `--actions`, `--images`, `--debug-logs`, `--diagnosis`, `--all` | boolean | | `false` |
| `key` | `--key` | snake_case error type key | | |
| `errorTypeDescription` | `--description` | what a failure of this type looks like | | |
| `verdict` | `--verdict` | `passed`, `failed` | | |
| `type` | `--type` | snake_case error type key | | |
| `summary` | `--summary` | text | | |

A boolean reads `true`, `1`, `yes`, `on`, `y`, `enabled` and `false`, `0`, `no`, `off`, `n`,
`disabled` (`z.stringbool()`). Every text value is non-empty.

## What does not compile

| Mistake | What tsc says |
|---|---|
| A flag a command above declares, or `help` | `Type 'Flag<...>' is not assignable to type 'Flag<...> & "serverUrl is already a flag here"'` |
| Two siblings with one name, a group's name included | `Argument of type '"mint"' is not assignable to parameter of type '"mint is already a command"'` |
| A name starting with `-`, or two words | `... parameter of type '"a command is one word that does not start with -"'` |
| `.flags()` or `.needs()` after a sub-command | `Property 'flags' does not exist on type 'Group<...>'` |
| A command left open, handed to `create` | `Type 'Group<...>' is missing the following properties from type 'App<unknown>'` |
| One `.done()` too many | `Property 'done' does not exist on type 'App<...>'` |
| A flag called with anything but nothing or `false` | `No overload matches this call` |
| A `case` for a command that only routes | `Type '"test run"' is not comparable to type '"mint" \| ...'` |
