import { readFileSync } from "node:fs";
import { Cause, Exit, Result, Schema } from "effect";
import * as Oligarchy from "@oligarchy/env/oligarchy";
import * as Render from "@oligarchy/log/render";
import * as Errors from "../shared/errors.ts";

// The model drives the guest through ./client. client.md is that tool's
// definition, read here so a new command is not copied into this module.
// Intent, and marking a result started or completed, are the harness's. The
// model is not given ./ctrl. Resolved from the settings file's root, the one
// URL the driver bundle defines.
export const clientGuide = readFileSync(new URL("client.md", Oligarchy.ROOT), "utf8");

export type CommandLine = {
  readonly bin: "./client";
  readonly args: ReadonlyArray<string>;
};

export type CommandOutput = {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
};

type ToolParameters = {
  readonly type: "object";
  readonly additionalProperties: false;
  readonly required: ReadonlyArray<"args">;
  readonly properties: {
    readonly args: {
      readonly type: "array";
      readonly items: { readonly type: "string" };
      readonly description: string;
    };
  };
};

export type ToolDefinition = {
  readonly type: "function";
  readonly function: {
    readonly name: "client";
    readonly description: string;
    readonly parameters: ToolParameters;
  };
};

const parameters: ToolParameters = {
  type: "object",
  additionalProperties: false,
  required: ["args"],
  properties: {
    args: {
      type: "array",
      items: { type: "string" },
      description: "The action, then its flags, as client.md writes them.",
    },
  },
};

export const TOOLS: ReadonlyArray<ToolDefinition> = [
  {
    type: "function",
    function: { name: "client", description: clientGuide, parameters },
  },
];

const ClientArguments = Schema.Struct({
  args: Schema.Array(Schema.String),
});

const decodeClientArguments = Schema.decodeUnknownExit(
  Schema.fromJsonString(Schema.toCodecJson(ClientArguments)),
  { onExcessProperty: "error" },
);

const fail = (message: string): Result.Result<never, Errors.ToolError> =>
  Result.fail(Errors.ToolError.make({ message }));

export const commandLine = (call: {
  readonly name: string;
  readonly arguments: string;
}): Result.Result<CommandLine, Errors.ToolError> => {
  if (call.name !== "client") {
    return fail(`unknown tool "${call.name}"; the model runs ./client`);
  }
  const decoded = decodeClientArguments(call.arguments);
  if (Exit.isFailure(decoded)) {
    return fail(`client: ${Render.headline(Cause.squash(decoded.cause))}`);
  }
  // client.md still tells a driving agent to open intents. The harness does
  // that itself, so a model-issued intent would open a second one.
  if (decoded.value.args[0] === "intent") {
    return fail("client: the harness opens and closes intents");
  }
  return Result.succeed({
    bin: "./client",
    args: [...decoded.value.args],
  });
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
