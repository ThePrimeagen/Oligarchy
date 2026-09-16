import { Option, Schema } from "effect";
import * as Domain from "../shared/domain.ts";

export const HELP = `start [iso] [disk]                    boot a qemu session (default iso: omarchy.iso)
get-image                             show the guest display inline
get-serial                            print the guest serial console
send-keys <keys>                      type into the guest, e.g. send-keys hello<ENTER>
mouse <verb> <x> <y> [...]            move, click, double-click, scroll, drag, hold or release; "mouse" then tab lists the verbs
intent start <message>                declare what you are about to do
intent end                            close the open intent
stop [status] [reason]                stop the session; status is succeeded, failed, or aborted
follow <session-id>                   watch another session live; "follow " then tab picks one; ctrl-c detaches
status                                show agent, server, session, and intent
exit                                  stop the session and leave`;

export const HINT =
  'tab lists commands; "follow " then tab lists active sessions; "help" explains them; "exit" stops the session and leaves';

export const COMMANDS: ReadonlyArray<string> = [
  "start",
  "get-image",
  "get-serial",
  "send-keys",
  "mouse",
  "intent",
  "stop",
  "follow",
  "status",
  "help",
  "exit",
  "quit",
];

export const STOP_STATUSES: ReadonlyArray<string> = Domain.StopStatus.literals;

export const MOUSE_VERBS: ReadonlyArray<string> = [
  "move",
  "click",
  "double-click",
  "scroll",
  "drag",
  "hold",
  "release",
];

// A manual session has no Linear ticket, so its intents carry this result id.
export const MANUAL_RESULT_ID = "manual";

export const unknownCommand = (command: string): string =>
  `unknown command: ${command}. tab lists commands; help explains them.`;

export type MalformedCommand =
  | "start"
  | "send-keys"
  | "mouse"
  | "intent"
  | "intent-start"
  | "intent-end"
  | "stop"
  | "follow";

export type Start = {
  readonly _tag: "start";
  readonly iso: Option.Option<string>;
  readonly disk: Option.Option<string>;
};

export type ClientCommand =
  | Start
  | { readonly _tag: "get-image" }
  | { readonly _tag: "get-serial" }
  | { readonly _tag: "send-keys"; readonly keys: string }
  // The verb and the client flags its words became, `--session-id` still to come.
  | { readonly _tag: "mouse"; readonly verb: string; readonly flags: ReadonlyArray<string> }
  | { readonly _tag: "intent-start"; readonly message: string }
  | { readonly _tag: "intent-end" }
  | {
      readonly _tag: "stop";
      readonly status: Option.Option<Domain.StopStatus>;
      readonly reason: Option.Option<string>;
    }
  | { readonly _tag: "follow"; readonly id: string };

export type Command =
  | ClientCommand
  | { readonly _tag: "status" }
  | { readonly _tag: "help" }
  | { readonly _tag: "exit" }
  | { readonly _tag: "malformed"; readonly command: MalformedCommand; readonly usage: string }
  | { readonly _tag: "unknown"; readonly command: string };

// These print `no session. run start first.` before their usage is judged.
export const needsSession = (command: MalformedCommand): boolean =>
  command === "send-keys" ||
  command === "mouse" ||
  command === "intent-start" ||
  command === "intent-end" ||
  command === "stop";

const malformed = (command: MalformedCommand, usage: string): Command => ({
  _tag: "malformed",
  command,
  usage,
});

const words = (rest: string): ReadonlyArray<string> => (rest === "" ? [] : rest.split(/\s+/));

const isStopStatus = Schema.is(Domain.StopStatus);

const parseIntent = (rest: string): Command => {
  const verb = rest.split(/\s+/, 1)[0];
  const message = rest.slice(verb.length).trim();
  switch (verb) {
    case "start":
      return message === ""
        ? malformed("intent-start", "usage: intent start <message>")
        : { _tag: "intent-start", message };
    case "end":
      return message === "" ? { _tag: "intent-end" } : malformed("intent-end", "usage: intent end");
    default:
      return malformed("intent", "usage: intent start <message> | intent end");
  }
};

const optional = (flag: string, value: Option.Option<string>): ReadonlyArray<string> =>
  Option.match(value, { onNone: () => [], onSome: (found) => [flag, found] });

// `mouse <verb> <x> <y> ...`: the words after the verb become the client's flags in order; a
// count outside the verb's arity is that verb's usage, an unknown verb the list of verbs.
const parseMouse = (rest: string): Command => {
  const [verb, ...args] = words(rest);
  switch (verb) {
    case "move": {
      const [x, y, ...extra] = args;
      if (x === undefined || y === undefined || extra.length > 0) {
        return malformed("mouse", "usage: mouse move <x> <y>");
      }
      return { _tag: "mouse", verb, flags: ["--x", x, "--y", y] };
    }
    case "click":
    case "double-click":
    case "hold":
    case "release": {
      const [x, y, button, ...extra] = args;
      if (x === undefined || y === undefined || extra.length > 0) {
        return malformed("mouse", `usage: mouse ${verb} <x> <y> [button]`);
      }
      return {
        _tag: "mouse",
        verb,
        flags: ["--x", x, "--y", y, ...optional("--button", Option.fromNullishOr(button))],
      };
    }
    case "scroll": {
      const [x, y, direction, ticks, ...extra] = args;
      if (x === undefined || y === undefined || direction === undefined || extra.length > 0) {
        return malformed("mouse", "usage: mouse scroll <x> <y> <up|down|left|right> [ticks]");
      }
      return {
        _tag: "mouse",
        verb,
        flags: [
          "--x",
          x,
          "--y",
          y,
          "--direction",
          direction,
          ...optional("--ticks", Option.fromNullishOr(ticks)),
        ],
      };
    }
    case "drag": {
      const [x, y, toX, toY, button, ...extra] = args;
      if (
        x === undefined ||
        y === undefined ||
        toX === undefined ||
        toY === undefined ||
        extra.length > 0
      ) {
        return malformed("mouse", "usage: mouse drag <x> <y> <to-x> <to-y> [button]");
      }
      return {
        _tag: "mouse",
        verb,
        flags: [
          "--from-x",
          x,
          "--from-y",
          y,
          "--to-x",
          toX,
          "--to-y",
          toY,
          ...optional("--button", Option.fromNullishOr(button)),
        ],
      };
    }
    default:
      return malformed(
        "mouse",
        "usage: mouse <move|click|double-click|scroll|drag|hold|release> ...",
      );
  }
};

const parseStop = (rest: string): Command => {
  if (rest === "") {
    return { _tag: "stop", status: Option.none(), reason: Option.none() };
  }
  const status = rest.split(/\s+/, 1)[0];
  if (!isStopStatus(status)) {
    return malformed("stop", "usage: stop [succeeded|failed|aborted] [reason]");
  }
  const reason = rest.slice(status.length).trim();
  return {
    _tag: "stop",
    status: Option.some(status),
    reason: reason === "" ? Option.none() : Option.some(reason),
  };
};

export const parseLine = (line: string): Command => {
  const trimmed = line.trim();
  const command = trimmed.split(/\s+/, 1)[0];
  const rest = trimmed.slice(command.length).trim();
  switch (command) {
    case "start": {
      const parts = words(rest);
      if (parts.length > 2) {
        return malformed("start", "usage: start [iso] [disk]");
      }
      return {
        _tag: "start",
        iso: Option.fromNullishOr(parts[0]),
        disk: Option.fromNullishOr(parts[1]),
      };
    }
    case "get-image":
      return { _tag: "get-image" };
    case "get-serial":
      return { _tag: "get-serial" };
    case "send-keys":
      return rest === ""
        ? malformed("send-keys", "usage: send-keys <keys>")
        : { _tag: "send-keys", keys: rest };
    case "mouse":
      return parseMouse(rest);
    case "intent":
      return parseIntent(rest);
    case "stop":
      return parseStop(rest);
    case "follow": {
      const parts = words(rest);
      const id = parts[0];
      return parts.length === 1 && id !== undefined
        ? { _tag: "follow", id }
        : malformed("follow", "usage: follow <session-id>");
    }
    case "status":
      return { _tag: "status" };
    case "help":
      return { _tag: "help" };
    case "exit":
    case "quit":
      return { _tag: "exit" };
    default:
      return { _tag: "unknown", command };
  }
};

// The client's argv for one command, without `--agent-id` and `--server-url` (children.ts
// appends those). `start` has no session yet and ignores the id.
export const toClientArgs = (command: ClientCommand, sessionId: string): ReadonlyArray<string> => {
  switch (command._tag) {
    case "start":
      return ["start", ...optional("--iso", command.iso), ...optional("--disk", command.disk)];
    case "get-image":
      return ["get-image", "--session-id", sessionId];
    case "get-serial":
      return ["get-serial", "--session-id", sessionId];
    case "send-keys":
      return ["send-keys", "--session-id", sessionId, "--keys", command.keys];
    case "mouse":
      return ["mouse", command.verb, "--session-id", sessionId, ...command.flags];
    case "intent-start":
      return [
        "intent",
        "start",
        "--session-id",
        sessionId,
        "--test-result-id",
        MANUAL_RESULT_ID,
        "--message",
        command.message,
      ];
    case "intent-end":
      return ["intent", "end", "--session-id", sessionId];
    case "stop":
      return [
        "stop",
        "--session-id",
        sessionId,
        ...Option.match(command.status, {
          onNone: () => [],
          onSome: (status) => ["--status", status, ...optional("--reason", command.reason)],
        }),
      ];
    case "follow":
      return ["follow", "--session-id", command.id];
  }
  return command satisfies never;
};

export type Completion = readonly [ReadonlyArray<string>, string];

export type Completing =
  | { readonly _tag: "words"; readonly completion: Completion }
  | { readonly _tag: "follow"; readonly prefix: string };

const startingWith = (candidates: ReadonlyArray<string>, word: string): Completion => [
  candidates.filter((candidate) => candidate.startsWith(word)),
  word,
];

export const complete = (line: string): Completing => {
  const followArg = /^\s*follow\s+(\S*)$/.exec(line);
  if (followArg !== null) {
    return { _tag: "follow", prefix: followArg[1] };
  }
  const mouseArg = /^\s*mouse\s+(\S*)$/.exec(line);
  if (mouseArg !== null) {
    return { _tag: "words", completion: startingWith(MOUSE_VERBS, mouseArg[1]) };
  }
  const intentArg = /^\s*intent\s+(\S*)$/.exec(line);
  if (intentArg !== null) {
    return { _tag: "words", completion: startingWith(["start", "end"], intentArg[1]) };
  }
  const stopArg = /^\s*stop\s+(\S*)$/.exec(line);
  if (stopArg !== null) {
    return { _tag: "words", completion: startingWith(STOP_STATUSES, stopArg[1]) };
  }
  const word = line.trimStart();
  if (/\s/.test(word)) {
    return { _tag: "words", completion: [[], line] };
  }
  return { _tag: "words", completion: startingWith(COMMANDS, word) };
};
