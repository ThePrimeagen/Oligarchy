import * as jarl from "jarl";
import * as z from "zod";
import * as Errors from "./errors.ts";

export type ToolCall = { readonly id: string; readonly name: string; readonly arguments: string };

export type Turn = { readonly content: string | null; readonly toolCalls: ReadonlyArray<ToolCall> };

// What one event did to the completion. A provider's failure carries the status it names, when
// it names one: OpenRouter writes the provider's status in `code`, inside the stream as outside.
export type Step =
  | { readonly kind: "more" }
  | { readonly kind: "done" }
  | { readonly kind: "failed"; readonly message: string; readonly status: number | undefined }
  | { readonly kind: "invalid"; readonly cause: unknown };

const ErrorPayload = z.union([
  z.string(),
  z.object({ message: z.string(), code: z.unknown().optional() }),
]);

const ToolCallDelta = z.object({
  index: z.int().min(0),
  id: z.string().optional(),
  function: z.object({ name: z.string().optional(), arguments: z.string().optional() }).optional(),
});

const Choice = z.object({
  finish_reason: z.string().nullable().optional(),
  error: z.unknown().optional(),
  delta: z
    .object({
      content: z.string().nullable().optional(),
      tool_calls: z.array(ToolCallDelta).optional(),
    })
    .optional(),
});

// Errors travel beside `choices`, so the envelope is read first: a failure's text is not lost
// to a chunk the choice schema would refuse.
const Envelope = z.object({ error: z.unknown().optional(), choices: z.unknown().optional() });

const Choices = z.array(Choice);

export const parseJson = (text: string): jarl.Result<unknown, unknown> => {
  try {
    return jarl.ok(JSON.parse(text));
  } catch (caught) {
    return jarl.err(caught);
  }
};

// A number, or digits in a string; a named code is no status.
const statusOf = (code: unknown): number | undefined => {
  if (typeof code === "number") {
    return code;
  }
  return typeof code === "string" && /^\d+$/.test(code) ? Number(code) : undefined;
};

const failed = (error: unknown): Step => {
  const payload = ErrorPayload.safeParse(error);
  if (!payload.success) {
    return { kind: "invalid", cause: payload.error };
  }
  const { data } = payload;
  return typeof data === "string"
    ? { kind: "failed", message: data, status: undefined }
    : { kind: "failed", message: data.message, status: statusOf(data.code) };
};

type Partial = { id: string | undefined; name: string | undefined; arguments: string };

// One streamed completion, folded an event at a time. Tool calls arrive in pieces keyed by index.
export const fold = () => {
  let content: string | null = null;
  let sawChoice = false;
  const calls = new Map<number, Partial>();

  const absorb = (delta: z.output<typeof ToolCallDelta>): void => {
    const call = calls.get(delta.index) ?? { id: undefined, name: undefined, arguments: "" };
    if (delta.id !== undefined && delta.id !== "") {
      call.id = delta.id;
    }
    const name = delta.function?.name;
    if (name !== undefined && name !== "") {
      call.name = name;
    }
    call.arguments = `${call.arguments}${delta.function?.arguments ?? ""}`;
    calls.set(delta.index, call);
  };

  const apply = (data: string): Step => {
    if (data === "[DONE]") {
      return { kind: "done" };
    }
    const parsed = parseJson(data);
    if (jarl.is_err(parsed)) {
      return { kind: "invalid", cause: parsed.error };
    }
    const envelope = Envelope.safeParse(jarl.value(parsed));
    if (!envelope.success) {
      return { kind: "invalid", cause: envelope.error };
    }
    if (envelope.data.error !== undefined) {
      return failed(envelope.data.error);
    }
    if (envelope.data.choices === undefined) {
      return { kind: "more" };
    }
    const choices = Choices.safeParse(envelope.data.choices);
    if (!choices.success) {
      return { kind: "invalid", cause: choices.error };
    }
    const [choice] = choices.data;
    if (choice === undefined) {
      return { kind: "more" };
    }
    sawChoice = true;
    if (choice.error !== undefined) {
      return failed(choice.error);
    }
    const text = choice.delta?.content;
    if (typeof text === "string") {
      content = `${content ?? ""}${text}`;
    }
    for (const call of choice.delta?.tool_calls ?? []) {
      absorb(call);
    }
    return typeof choice.finish_reason === "string" ? { kind: "done" } : { kind: "more" };
  };

  const turn = (): jarl.Result<Turn, Errors.OpenRouterUnreachable> => {
    if (!sawChoice) {
      return jarl.err(Errors.unreachable("openrouter: stream ended before the completion"));
    }
    const toolCalls: Array<ToolCall> = [];
    for (const [, call] of [...calls].sort(([left], [right]) => left - right)) {
      if (call.id === undefined) {
        return jarl.err(Errors.unreachable("openrouter: a tool call has no id"));
      }
      if (call.name === undefined) {
        return jarl.err(Errors.unreachable("openrouter: a tool call has no name"));
      }
      toolCalls.push({ id: call.id, name: call.name, arguments: call.arguments });
    }
    return jarl.ok({ content, toolCalls });
  };

  return { apply, turn };
};
