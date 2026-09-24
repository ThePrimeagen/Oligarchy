import { Cause, Exit, Result, Schema } from "effect";
import * as Tools from "../harness/tools.ts";
import * as Render from "../observability/render.ts";
import * as Errors from "../shared/errors.ts";

// One line, the tool call. client runs that action. Done leaves the loop and runs nothing.
export type Reply =
  | { readonly _tag: "Done" }
  | {
      readonly _tag: "client";
      readonly reason: string;
      readonly withImage: boolean;
      readonly args: ReadonlyArray<string>;
    };

const fail = (message: string): Result.Result<never, Errors.ToolError> =>
  Result.fail(Errors.ToolError.make({ message }));

const Call = Schema.Struct({
  name: Schema.String,
  arguments: Schema.Unknown,
});

const ClientArguments = Schema.Struct({
  reason: Schema.String,
  withImage: Schema.optionalKey(Schema.Boolean),
  args: Schema.Array(Schema.String),
});

const decodeCall = Schema.decodeUnknownExit(Schema.fromJsonString(Schema.toCodecJson(Call)), {
  onExcessProperty: "error",
});

const decodeClientArguments = Schema.decodeUnknownExit(ClientArguments, {
  onExcessProperty: "error",
});

// An empty struct does not reject keys, so Done's arguments are checked here.
const doneArguments = (value: unknown): Result.Result<void, Errors.ToolError> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return fail("reply: Done takes no arguments");
  }
  if (Object.keys(value).length !== 0) {
    return fail("reply: Done takes no arguments");
  }
  return Result.void;
};

const schemaFailure = (cause: Cause.Cause<unknown>): Result.Result<never, Errors.ToolError> =>
  fail(`reply: ${Render.headline(Cause.squash(cause))}`);

export const parse = (text: string): Result.Result<Reply, Errors.ToolError> => {
  const line = text.trim();
  if (line === "" || line.includes("\n")) {
    return fail("reply: expected 1 line");
  }
  const decoded = decodeCall(line);
  if (Exit.isFailure(decoded)) {
    return schemaFailure(decoded.cause);
  }
  if (decoded.value.name === "Done") {
    const args = doneArguments(decoded.value.arguments);
    if (Result.isFailure(args)) {
      return fail(args.failure.message);
    }
    return Result.succeed({ _tag: "Done" });
  }
  if (decoded.value.name !== "client") {
    return fail(`reply: unknown tool "${decoded.value.name}"`);
  }
  const args = decodeClientArguments(decoded.value.arguments);
  if (Exit.isFailure(args)) {
    return schemaFailure(args.cause);
  }
  const reason = args.value.reason.trim();
  if (reason === "") {
    return fail("reply: reason is why");
  }
  if (args.value.args.length === 0) {
    return fail("reply: the action is empty");
  }
  return Result.succeed({
    _tag: "client",
    reason,
    withImage: args.value.withImage === true,
    args: args.value.args,
  });
};

// A leading ./client or ./client-with-image selects the bin. ./ctrl and ./session are not
// this loop: a diagnose still runs under OpenCode.
export const command = (
  call: Extract<Reply, { readonly _tag: "client" }>,
): Result.Result<Tools.CommandLine, Errors.ToolError> => {
  const head = call.args[0];
  if (head === "./ctrl" || head === "./session") {
    return fail("reply: the harness runs ./ctrl");
  }
  const prefixed = head === "./client" || head === "./client-with-image";
  const args = prefixed ? call.args.slice(1) : call.args;
  if (args.length === 0) {
    return fail("reply: the action is empty");
  }
  const image = call.withImage || head === "./client-with-image";
  return Tools.commandLine({
    name: "client",
    arguments: JSON.stringify({
      ...(image ? { withImage: true } : {}),
      args,
    }),
  });
};
