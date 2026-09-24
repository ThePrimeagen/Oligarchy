import { Result, Schema } from "effect";
import * as Errors from "../shared/errors.ts";

// What the model asked to run. `arguments` is the JSON it sent, kept verbatim
// until a tool call is turned into a command line.
export class ToolCall extends Schema.Class<ToolCall>("@oligarchy/harness/history/ToolCall")({
  id: Schema.NonEmptyString,
  name: Schema.String,
  arguments: Schema.String,
}) {}

export class SystemMessage extends Schema.Class<SystemMessage>(
  "@oligarchy/harness/history/SystemMessage",
)({
  role: Schema.Literal("system"),
  content: Schema.String,
}) {}

export class UserMessage extends Schema.Class<UserMessage>(
  "@oligarchy/harness/history/UserMessage",
)({
  role: Schema.Literal("user"),
  content: Schema.String,
}) {}

export class AssistantMessage extends Schema.Class<AssistantMessage>(
  "@oligarchy/harness/history/AssistantMessage",
)({
  role: Schema.Literal("assistant"),
  content: Schema.NullOr(Schema.String),
  toolCalls: Schema.Array(ToolCall),
}) {}

export class ToolMessage extends Schema.Class<ToolMessage>(
  "@oligarchy/harness/history/ToolMessage",
)({
  role: Schema.Literal("tool"),
  toolCallId: Schema.NonEmptyString,
  content: Schema.String,
  // null: the call was refused and never ran. A number: the process exit code.
  exitCode: Schema.NullOr(Schema.Int),
}) {}

export const Message = Schema.Union([
  SystemMessage,
  UserMessage,
  AssistantMessage,
  ToolMessage,
]).annotate({
  identifier: "@oligarchy/harness/history/Message",
});
export type Message = typeof Message.Type;

export class History extends Schema.Class<History>("@oligarchy/harness/history/History")({
  messages: Schema.Array(Message),
}) {}

export type WireToolCall = {
  readonly id: string;
  readonly type: "function";
  readonly function: {
    readonly name: string;
    readonly arguments: string;
  };
};

export type WirePart =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "image_url"; readonly image_url: { readonly url: string } };

// OpenRouter chat completions. exitCode stays off the wire: it is how the loop
// decides, and the model reads `content`.
export type WireMessage =
  | { readonly role: "system"; readonly content: string }
  | { readonly role: "user"; readonly content: string | ReadonlyArray<WirePart> }
  | { readonly role: "assistant"; readonly content: string | null }
  | {
      readonly role: "assistant";
      readonly content: string | null;
      readonly tool_calls: ReadonlyArray<WireToolCall>;
    }
  | { readonly role: "tool"; readonly tool_call_id: string; readonly content: string };

export type AssistantTurn = {
  readonly content: string | null;
  readonly toolCalls: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly arguments: string;
  }>;
};

export type ToolOutput = {
  readonly toolCallId: string;
  readonly content: string;
  readonly exitCode: number | null;
};

const fail = (message: string): Result.Result<never, Errors.HistoryError> =>
  Result.fail(Errors.HistoryError.make({ message }));

// The latest assistant's tool calls that do not yet have a tool message.
const openCalls = (history: History): ReadonlyArray<ToolCall> => {
  let assistant: AssistantMessage | undefined;
  let at = -1;
  for (let i = 0; i < history.messages.length; i++) {
    const message = history.messages[i];
    if (message !== undefined && message.role === "assistant") {
      assistant = message;
      at = i;
    }
  }
  if (assistant === undefined || assistant.toolCalls.length === 0) {
    return [];
  }
  const answered = new Set<string>();
  for (let i = at + 1; i < history.messages.length; i++) {
    const message = history.messages[i];
    if (message !== undefined && message.role === "tool") {
      answered.add(message.toolCallId);
    }
  }
  return assistant.toolCalls.filter((call) => !answered.has(call.id));
};

const withMessage = (history: History, message: Message): History =>
  History.make({ messages: [...history.messages, message] });

export const begin = (
  system: string,
  prompt: string,
): Result.Result<History, Errors.HistoryError> => {
  if (system === "") {
    return fail("system prompt is empty");
  }
  if (prompt === "") {
    return fail("user prompt is empty");
  }
  return Result.succeed(
    History.make({
      messages: [
        SystemMessage.make({ role: "system", content: system }),
        UserMessage.make({ role: "user", content: prompt }),
      ],
    }),
  );
};

export const recordAssistant = (
  history: History,
  turn: AssistantTurn,
): Result.Result<History, Errors.HistoryError> => {
  const open = openCalls(history);
  const pending = open[0];
  if (pending !== undefined) {
    return fail(`tool call "${pending.id}" is still open`);
  }
  const calls: Array<ToolCall> = [];
  const seen = new Set<string>();
  for (const call of turn.toolCalls) {
    if (call.id === "") {
      return fail("a tool call id is empty");
    }
    if (seen.has(call.id)) {
      return fail(`tool call id "${call.id}" is repeated`);
    }
    seen.add(call.id);
    calls.push(ToolCall.make({ id: call.id, name: call.name, arguments: call.arguments }));
  }
  return Result.succeed(
    withMessage(
      history,
      AssistantMessage.make({ role: "assistant", content: turn.content, toolCalls: calls }),
    ),
  );
};

export const recordToolResult = (
  history: History,
  output: ToolOutput,
): Result.Result<History, Errors.HistoryError> => {
  const open = openCalls(history);
  const pending = open[0];
  if (pending === undefined) {
    return fail("no tool call is open");
  }
  if (output.toolCallId !== pending.id) {
    return fail(`tool result "${output.toolCallId}" does not answer tool call "${pending.id}"`);
  }
  return Result.succeed(
    withMessage(
      history,
      ToolMessage.make({
        role: "tool",
        toolCallId: output.toolCallId,
        content: output.content,
        exitCode: output.exitCode,
      }),
    ),
  );
};

const assistantWire = (message: AssistantMessage): WireMessage => {
  if (message.toolCalls.length === 0) {
    return { role: "assistant", content: message.content };
  }
  return {
    role: "assistant",
    content: message.content,
    tool_calls: message.toolCalls.map((call) => ({
      id: call.id,
      type: "function" as const,
      function: { name: call.name, arguments: call.arguments },
    })),
  };
};

export const wire = (history: History): ReadonlyArray<WireMessage> => {
  const messages: Array<WireMessage> = [];
  for (const message of history.messages) {
    switch (message.role) {
      case "system":
        messages.push({ role: "system", content: message.content });
        break;
      case "user":
        messages.push({ role: "user", content: message.content });
        break;
      case "assistant":
        messages.push(assistantWire(message));
        break;
      case "tool":
        messages.push({ role: "tool", tool_call_id: message.toolCallId, content: message.content });
        break;
      default:
        return message satisfies never;
    }
  }
  return messages;
};
