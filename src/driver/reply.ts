import { Cause, Exit, Result, Schema } from "effect";
import type * as Tools from "../harness/tools.ts";
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

const ClientCall = Schema.Struct({
  name: Schema.Literal("client"),
  arguments: Schema.Struct({
    reason: Schema.String,
    withImage: Schema.optionalKey(Schema.Boolean),
    args: Schema.Array(Schema.String),
  }),
});

const DoneCall = Schema.Struct({
  name: Schema.Literal("Done"),
  arguments: Schema.Struct({}),
});

const Call = Schema.Union([DoneCall, ClientCall]);

const decodeCall = Schema.decodeUnknownExit(Schema.fromJsonString(Schema.toCodecJson(Call)), {
  onExcessProperty: "error",
});

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
    // Struct({}) compiles to a not-nullish check, so excess keys are not rejected.
    const args = decoded.value.arguments;
    if (
      typeof args !== "object" ||
      args === null ||
      Array.isArray(args) ||
      Object.keys(args).length !== 0
    ) {
      return fail("reply: Done takes no arguments");
    }
    return Result.succeed({ _tag: "Done" });
  }
  const reason = decoded.value.arguments.reason.trim();
  if (reason === "") {
    return fail("reply: reason is why");
  }
  if (decoded.value.arguments.args.length === 0) {
    return fail("reply: the action is empty");
  }
  return Result.succeed({
    _tag: "client",
    reason,
    withImage: decoded.value.arguments.withImage === true,
    args: decoded.value.arguments.args,
  });
};

// client.md still tells a driving agent to open intents. The harness does that itself, so a
// model-issued intent would open a second one.
export const command = (
  call: Extract<Reply, { readonly _tag: "client" }>,
): Result.Result<Tools.CommandLine, Errors.ToolError> => {
  if (call.args[0] === "intent") {
    return fail("client: the harness opens and closes intents");
  }
  return Result.succeed({
    bin: call.withImage ? "./client-with-image" : "./client",
    args: [...call.args],
  });
};
