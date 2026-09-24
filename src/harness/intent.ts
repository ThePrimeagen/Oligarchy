import { Result } from "effect";
import type * as Tools from "./tools.ts";
import * as Errors from "../shared/errors.ts";

// client.md: keys, mouse and images run inside an intent. start, reserve, relinquish,
// stop and save sit outside one. reserve names no session, so intent start cannot
// bracket it either. Anything else is the client's to refuse.
const GUEST = new Set(["send-keys", "mouse", "get-image", "get-serial", "follow"]);

export type Bracket =
  | { readonly _tag: "plain" }
  | {
      readonly _tag: "guest";
      readonly start: Tools.CommandLine;
      readonly end: Tools.CommandLine;
    };

const fail = (message: string): Result.Result<never, Errors.ToolError> =>
  Result.fail(Errors.ToolError.make({ message }));

const actionName = (args: ReadonlyArray<string>): string | undefined => {
  const name = args[0];
  if (name === undefined || name === "" || name.startsWith("-")) {
    return undefined;
  }
  return name;
};

// Last one wins, the same rule as a repeated flag on the client.
export const flag = (args: ReadonlyArray<string>, name: string): string | undefined => {
  const exact = `--${name}`;
  const prefix = `--${name}=`;
  let value: string | undefined;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === undefined) {
      continue;
    }
    if (arg.startsWith(prefix)) {
      const found = arg.slice(prefix.length);
      if (found !== "") {
        value = found;
      }
      continue;
    }
    if (arg !== exact) {
      continue;
    }
    const next = args[index + 1];
    if (next !== undefined && !next.startsWith("-")) {
      value = next;
    }
  }
  return value;
};

// The model's own words when it said what it is about to do; otherwise the action.
export const intentMessage = (content: string | null, args: ReadonlyArray<string>): string => {
  if (content !== null && content.trim() !== "") {
    return content.trim();
  }
  const action = actionName(args) ?? "client";
  const next = args[1];
  if (action === "mouse" && next !== undefined && !next.startsWith("-")) {
    return `mouse ${next}`;
  }
  return action;
};

export const bracket = (
  command: Tools.CommandLine,
  testResultId: string,
  message: string,
): Result.Result<Bracket, Errors.ToolError> => {
  const name = actionName(command.args);
  if (name === undefined || !GUEST.has(name)) {
    return Result.succeed({ _tag: "plain" });
  }
  const agent = flag(command.args, "agent-id");
  const session = flag(command.args, "session-id");
  if (agent === undefined || session === undefined) {
    return fail("client: a guest action needs --agent-id and --session-id");
  }
  if (message.trim() === "") {
    return fail("client: an intent needs a message");
  }
  if (testResultId === "") {
    return fail("client: an intent needs --test-result-id");
  }
  const server = flag(command.args, "server-url");
  const shared = [
    "--agent-id",
    agent,
    "--session-id",
    session,
    ...(server === undefined ? [] : ["--server-url", server]),
  ];
  return Result.succeed({
    _tag: "guest",
    start: {
      bin: "./client",
      args: ["intent", "start", ...shared, "--test-result-id", testResultId, "--message", message],
    },
    end: { bin: "./client", args: ["intent", "end", ...shared] },
  });
};

// The model names the action and that action's own flags. These three are the harness's:
// the ticket, the server this run was filed against, and the session start printed.
const HELD = ["agent-id", "session-id", "server-url"] as const;

const NEEDS_SESSION = new Set([
  "send-keys",
  "mouse",
  "get-image",
  "get-serial",
  "follow",
  "stop",
  "save",
]);

export type Held = {
  readonly agentId: string;
  readonly serverUrl: string;
  readonly sessionId: string;
};

const dropHeld = (args: ReadonlyArray<string>): Array<string> => {
  const kept: Array<string> = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) {
      continue;
    }
    const equals = HELD.find((name) => arg.startsWith(`--${name}=`));
    if (equals !== undefined) {
      continue;
    }
    const bare = HELD.find((name) => arg === `--${name}`);
    if (bare === undefined) {
      kept.push(arg);
      continue;
    }
    const next = args[index + 1];
    if (next !== undefined && !next.startsWith("-")) {
      index += 1;
    }
  }
  return kept;
};

// A copy of the three flags on the reply is dropped. The harness's values are what run.
// A run with no stored server has nothing to route, so --server-url is left off.
export const owned = (
  args: ReadonlyArray<string>,
  held: Held,
): Result.Result<ReadonlyArray<string>, Errors.ToolError> => {
  const action = dropHeld(args);
  const name = actionName(action);
  const needsSession = name !== undefined && NEEDS_SESSION.has(name);
  if (needsSession && held.sessionId === "") {
    return fail("client: the harness has no session");
  }
  return Result.succeed([
    ...action,
    "--agent-id",
    held.agentId,
    ...(held.serverUrl === "" ? [] : ["--server-url", held.serverUrl]),
    ...(needsSession ? ["--session-id", held.sessionId] : []),
  ]);
};
