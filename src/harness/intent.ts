import { Result } from "effect";
import * as Errors from "./errors.ts";

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

export const dropHeld = (args: ReadonlyArray<string>): Array<string> => {
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
