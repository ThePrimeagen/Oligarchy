import { Result } from "effect";
import * as Tools from "../harness/tools.ts";
import * as Errors from "../shared/errors.ts";

export type Status = "complete" | "continue";

export type Reply = {
  readonly status: Status;
  readonly did: string;
  readonly action: string;
};

const fail = (message: string): Result.Result<never, Errors.ToolError> =>
  Result.fail(Errors.ToolError.make({ message }));

// Three lines: complete or continue, what the agent did, the action.
export const parse = (text: string): Result.Result<Reply, Errors.ToolError> => {
  const lines = text.replace(/\n$/, "").split("\n");
  if (lines.length !== 3) {
    return fail("reply: expected 3 lines");
  }
  const status = lines[0]?.trim() ?? "";
  const did = lines[1]?.trim() ?? "";
  const action = lines[2]?.trim() ?? "";
  if (status !== "complete" && status !== "continue") {
    return fail("reply: line 1 must be complete or continue");
  }
  if (did === "") {
    return fail("reply: line 2 is what the agent did");
  }
  if (action === "") {
    return fail("reply: line 3 is the action");
  }
  return Result.succeed({ status, did, action });
};

const tokens = (action: string): Result.Result<ReadonlyArray<string>, Errors.ToolError> => {
  const args: Array<string> = [];
  let current = "";
  let quote: string | undefined;
  for (const char of action) {
    if (quote !== undefined) {
      if (char === quote) {
        quote = undefined;
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === " " || char === "\t") {
      if (current !== "") {
        args.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (quote !== undefined) {
    return fail("reply: an action quote is unfinished");
  }
  if (current !== "") {
    args.push(current);
  }
  if (args.length === 0) {
    return fail("reply: line 3 is the action");
  }
  return Result.succeed(args);
};

// Line 3 is one ./client command. A leading ./client or ./client-with-image selects the bin.
export const command = (action: string): Result.Result<Tools.CommandLine, Errors.ToolError> => {
  const split = tokens(action);
  if (Result.isFailure(split)) {
    return fail(split.failure.message);
  }
  const [head, ...rest] = split.success;
  const image = head === "./client-with-image";
  const args = head === "./client" || image ? rest : split.success;
  return Tools.commandLine({
    name: "client",
    arguments: JSON.stringify({
      ...(image ? { withImage: true } : {}),
      args,
    }),
  });
};
