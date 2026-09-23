import { Cause, Exit, Result, Schema } from "effect";
import * as Render from "../observability/render.ts";
import * as Errors from "../shared/errors.ts";

// A driver runs these commands and only these. ./ctrl test run, mint and
// automation file tickets; ./client follow and the ./session repl are not
// one-shot commands. Flag mistakes stay on the command line: ./client, ./ctrl
// and ./session already refuse them. ./client-with-image is ./client plus a
// screenshot: same argv, other binary.

export type CommandLine = {
  readonly bin: "./client" | "./client-with-image" | "./ctrl" | "./session";
  readonly args: ReadonlyArray<string>;
};

export type CommandOutput = {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
};

type ArgsProperty = {
  readonly type: "array";
  readonly items: { readonly type: "string" };
  readonly description: string;
};

type ToolParameters = {
  readonly type: "object";
  readonly additionalProperties: false;
  readonly required: ReadonlyArray<"args">;
  readonly properties: {
    readonly args: ArgsProperty;
    readonly withImage?: {
      readonly type: "boolean";
      readonly description: string;
    };
  };
};

export type ToolDefinition = {
  readonly type: "function";
  readonly function: {
    readonly name: string;
    readonly description: string;
    readonly parameters: ToolParameters;
  };
};

const CLIENT: ReadonlyArray<ReadonlyArray<string>> = [
  ["start"],
  ["reserve"],
  ["relinquish"],
  ["get-image"],
  ["get-serial"],
  ["send-keys"],
  ["mouse", "move"],
  ["mouse", "click"],
  ["mouse", "double-click"],
  ["mouse", "scroll"],
  ["mouse", "drag"],
  ["mouse", "hold"],
  ["mouse", "release"],
  ["intent", "start"],
  ["intent", "end"],
  ["stop"],
  ["save"],
];

const CTRL: ReadonlyArray<ReadonlyArray<string>> = [
  ["test", "start"],
  ["test-results"],
  ["session"],
  ["error-type", "list"],
  ["error-type", "new"],
  ["diagnose"],
];

const SESSION: ReadonlyArray<ReadonlyArray<string>> = [["image"]];

const ClientArguments = Schema.Struct({
  withImage: Schema.optionalKey(Schema.Boolean),
  args: Schema.Array(Schema.String),
});

const Arguments = Schema.Struct({
  args: Schema.Array(Schema.String),
});

const decodeClientArguments = Schema.decodeUnknownExit(
  Schema.fromJsonString(Schema.toCodecJson(ClientArguments)),
  { onExcessProperty: "error" },
);

const decodeArguments = Schema.decodeUnknownExit(
  Schema.fromJsonString(Schema.toCodecJson(Arguments)),
  { onExcessProperty: "error" },
);

const fail = (message: string): Result.Result<never, Errors.ToolError> =>
  Result.fail(Errors.ToolError.make({ message }));

const toolFailure = (tool: string, cause: unknown): Errors.ToolError =>
  Errors.ToolError.make({ message: `${tool}: ${Render.headline(cause)}` });

const commandList = (commands: ReadonlyArray<ReadonlyArray<string>>): string =>
  commands.map((words) => words.join(" ")).join(", ");

const argsProperty: ArgsProperty = {
  type: "array",
  items: { type: "string" },
  description: "The action, then its flags, as the guide writes them.",
};

const parameters = (withImage: boolean): ToolParameters => {
  if (!withImage) {
    return {
      type: "object",
      additionalProperties: false,
      required: ["args"],
      properties: { args: argsProperty },
    };
  }
  return {
    type: "object",
    additionalProperties: false,
    required: ["args"],
    properties: {
      withImage: {
        type: "boolean",
        description:
          "Run ./client-with-image instead of ./client: the same action, then a screenshot.",
      },
      args: argsProperty,
    },
  };
};

const definition = (name: string, description: string, withImage: boolean): ToolDefinition => ({
  type: "function",
  function: { name, description, parameters: parameters(withImage) },
});

export const TOOLS: ReadonlyArray<ToolDefinition> = [
  definition(
    "client",
    `Run ./client. The action comes first and every value is a flag. withImage runs ./client-with-image, the same action plus a screenshot. Commands: ${commandList(CLIENT)}.`,
    true,
  ),
  definition("ctrl", `Run ./ctrl. Commands: ${commandList(CTRL)}.`, false),
  definition("session", `Run ./session. Commands: ${commandList(SESSION)}.`, false),
];

const byLength = (
  commands: ReadonlyArray<ReadonlyArray<string>>,
): ReadonlyArray<ReadonlyArray<string>> =>
  [...commands].sort((left, right) => right.length - left.length);

const CLIENT_SORTED = byLength(CLIENT);
const CTRL_SORTED = byLength(CTRL);
const SESSION_SORTED = byLength(SESSION);

const wordsOf = (args: ReadonlyArray<string>): string => {
  const words: Array<string> = [];
  for (const token of args) {
    if (token.startsWith("-")) {
      break;
    }
    words.push(token);
  }
  return words.join(" ");
};

// A following word is a longer command, not a flag, so `test run` does not match
// `test start` and `session list` does not match `session`.
const match = (
  args: ReadonlyArray<string>,
  commands: ReadonlyArray<ReadonlyArray<string>>,
): boolean => {
  for (const words of commands) {
    if (args.length < words.length) {
      continue;
    }
    let same = true;
    for (let i = 0; i < words.length; i++) {
      if (args[i] !== words[i]) {
        same = false;
        break;
      }
    }
    if (!same) {
      continue;
    }
    const next = args[words.length];
    if (next !== undefined && !next.startsWith("-")) {
      continue;
    }
    return true;
  }
  return false;
};

const commandLineOf = (
  tool: string,
  args: ReadonlyArray<string>,
  commands: ReadonlyArray<ReadonlyArray<string>>,
  bin: CommandLine["bin"],
): Result.Result<CommandLine, Errors.ToolError> => {
  if (args.length === 0) {
    return fail(`${tool}: a command is required`);
  }
  if (!match(args, commands)) {
    return fail(`${tool}: unknown command "${wordsOf(args)}"`);
  }
  return Result.succeed({ bin, args: [...args] });
};

const clientBin = (withImage: boolean | undefined): CommandLine["bin"] =>
  withImage === true ? "./client-with-image" : "./client";

export const commandLine = (call: {
  readonly name: string;
  readonly arguments: string;
}): Result.Result<CommandLine, Errors.ToolError> => {
  if (call.name === "client") {
    const decoded = decodeClientArguments(call.arguments);
    if (Exit.isFailure(decoded)) {
      return Result.fail(toolFailure(call.name, Cause.squash(decoded.cause)));
    }
    return commandLineOf(
      "client",
      decoded.value.args,
      CLIENT_SORTED,
      clientBin(decoded.value.withImage),
    );
  }
  if (call.name === "ctrl") {
    const decoded = decodeArguments(call.arguments);
    if (Exit.isFailure(decoded)) {
      return Result.fail(toolFailure("ctrl", Cause.squash(decoded.cause)));
    }
    return commandLineOf("ctrl", decoded.value.args, CTRL_SORTED, "./ctrl");
  }
  if (call.name === "session") {
    const decoded = decodeArguments(call.arguments);
    if (Exit.isFailure(decoded)) {
      return Result.fail(toolFailure("session", Cause.squash(decoded.cause)));
    }
    return commandLineOf("session", decoded.value.args, SESSION_SORTED, "./session");
  }
  return fail(`unknown tool "${call.name}"; a driver runs client, ctrl or session`);
};

const join = (first: string, second: string): string => {
  if (first === "") {
    return second;
  }
  if (second === "") {
    return first;
  }
  if (first.endsWith("\n")) {
    return `${first}${second}`;
  }
  return `${first}\n${second}`;
};

// Success is the command's stdout, which is what the next call has to read
// (a session id, "saved"). A failure leads with stderr, where the headline is.
export const toolContent = (commandOutput: CommandOutput): string => {
  if (commandOutput.exitCode === 0) {
    return join(commandOutput.stdout, commandOutput.stderr);
  }
  return join(commandOutput.stderr, commandOutput.stdout);
};

export const closesResult = (line: CommandLine, exitCode: number): boolean =>
  exitCode === 0 && line.bin === "./ctrl" && line.args[0] === "test-results";
