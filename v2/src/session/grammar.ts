import { Option, Schema } from "effect";
import * as Domain from "../shared/domain.ts";

export const HELP = `start [iso] [disk]                    boot a qemu session (default iso: omarchy.iso)
get-image                             show the guest display inline
get-serial                            print the guest serial console
send-keys <keys>                      type into the guest, e.g. send-keys hello<ENTER>
send-mouse <x> <y> [button] [clicks]  move, click, or scroll; x and y are 0..1 fractions
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
  "send-mouse",
  "intent",
  "stop",
  "follow",
  "status",
  "help",
  "exit",
  "quit",
];

export const STOP_STATUSES: ReadonlyArray<string> = Domain.StopStatus.literals;

// A manual session has no Linear ticket, so its intents carry this result id.
export const MANUAL_RESULT_ID = "manual";

export const unknownCommand = (command: string): string =>
  `unknown command: ${command}. tab lists commands; help explains them.`;

export type MalformedCommand =
  | "start"
  | "send-keys"
  | "send-mouse"
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
  | {
      readonly _tag: "send-mouse";
      readonly x: string;
      readonly y: string;
      readonly button: Option.Option<string>;
      readonly clicks: Option.Option<string>;
    }
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

const CLIENT_TAGS: ReadonlySet<string> = new Set([
  "start",
  "get-image",
  "get-serial",
  "send-keys",
  "send-mouse",
  "intent-start",
  "intent-end",
  "stop",
  "follow",
]);

export const isClientCommand = (command: Command): command is ClientCommand =>
  CLIENT_TAGS.has(command._tag);

// These print `no session. run start first.` before their usage is judged.
export const needsSession = (command: MalformedCommand): boolean =>
  command === "send-keys" ||
  command === "send-mouse" ||
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
  const verb = rest.split(/\s+/, 1)[0] ?? "";
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

const parseStop = (rest: string): Command => {
  if (rest === "") {
    return { _tag: "stop", status: Option.none(), reason: Option.none() };
  }
  const status = rest.split(/\s+/, 1)[0] ?? "";
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
  const command = trimmed.split(/\s+/, 1)[0] ?? "";
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
    case "send-mouse": {
      const [x, y, button, clicks, ...extra] = words(rest);
      if (x === undefined || y === undefined || extra.length > 0) {
        return malformed("send-mouse", "usage: send-mouse <x> <y> [button] [clicks]");
      }
      return {
        _tag: "send-mouse",
        x,
        y,
        button: Option.fromNullishOr(button),
        clicks: Option.fromNullishOr(clicks),
      };
    }
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

const optional = (flag: string, value: Option.Option<string>): ReadonlyArray<string> =>
  Option.match(value, { onNone: () => [], onSome: (found) => [flag, found] });

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
    case "send-mouse":
      return [
        "send-mouse",
        "--session-id",
        sessionId,
        "--x",
        command.x,
        "--y",
        command.y,
        ...optional("--button", command.button),
        ...optional("--clicks", command.clicks),
      ];
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
    return { _tag: "follow", prefix: followArg[1] ?? "" };
  }
  const intentArg = /^\s*intent\s+(\S*)$/.exec(line);
  if (intentArg !== null) {
    return { _tag: "words", completion: startingWith(["start", "end"], intentArg[1] ?? "") };
  }
  const stopArg = /^\s*stop\s+(\S*)$/.exec(line);
  if (stopArg !== null) {
    return { _tag: "words", completion: startingWith(STOP_STATUSES, stopArg[1] ?? "") };
  }
  const word = line.trimStart();
  if (/\s/.test(word)) {
    return { _tag: "words", completion: [[], line] };
  }
  return { _tag: "words", completion: startingWith(COMMANDS, word) };
};
