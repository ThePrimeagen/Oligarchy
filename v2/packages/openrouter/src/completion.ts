import * as Http from "@oligarchy/http";
import * as jarl from "jarl";
import * as z from "zod";

export type ToolCall = { readonly id: string; readonly name: string; readonly arguments: string };

export type Turn = { readonly content: string | null; readonly toolCalls: ReadonlyArray<ToolCall> };

// The provider failed and said so in a 200's body. OpenRouter writes the provider's status in
// `code`; a named code, or none, is no status.
export class ProviderFailed extends jarl.error.define("ProviderFailed") {
  readonly status: number | undefined;
  constructor(message: string, status: number | undefined) {
    super(message);
    this.status = status;
  }
}

const Failure = z.union([
  z.string(),
  z.object({ message: z.string(), code: z.unknown().optional() }),
]);

const WireToolCall = z.object({
  id: z.string().min(1),
  function: z.object({ name: z.string().min(1), arguments: z.string() }),
});

const Message = z.object({
  content: z.string().nullable().optional(),
  tool_calls: z.array(WireToolCall).optional(),
});

const Choice = z.object({ message: Message.optional(), error: z.unknown().optional() });

// A failure travels beside the choices, so the answer is read for one before its choices are.
const Answer = z.object({
  error: z.unknown().optional(),
  choices: z.array(z.unknown()).optional(),
});

const notACompletion = (cause: unknown) =>
  jarl.err(new Http.HttpInvalid("not a completion", { cause }));

const statusOf = (code: unknown): number | undefined => {
  if (typeof code === "number") {
    return code;
  }
  return typeof code === "string" && /^\d+$/.test(code) ? Number(code) : undefined;
};

const failed = (error: unknown): jarl.Result<never, Http.HttpInvalid | ProviderFailed> => {
  const payload = Failure.safeParse(error);
  if (!payload.success) {
    return notACompletion(payload.error);
  }
  const { data } = payload;
  return jarl.err(
    typeof data === "string"
      ? new ProviderFailed(data, undefined)
      : new ProviderFailed(data.message, statusOf(data.code)),
  );
};

// The first choice's message: its text, and the tool calls it made.
export const decode = (body: unknown): jarl.Result<Turn, Http.HttpInvalid | ProviderFailed> => {
  const answer = Answer.safeParse(body);
  if (!answer.success) {
    return notACompletion(answer.error);
  }
  if (answer.data.error !== undefined) {
    return failed(answer.data.error);
  }
  const choice = Choice.safeParse(answer.data.choices?.[0]);
  if (!choice.success) {
    return notACompletion(choice.error);
  }
  if (choice.data.error !== undefined) {
    return failed(choice.data.error);
  }
  const { message } = choice.data;
  if (message === undefined) {
    return notACompletion(undefined);
  }
  return jarl.ok({
    content: message.content ?? null,
    toolCalls: (message.tool_calls ?? []).map((call) => ({
      id: call.id,
      name: call.function.name,
      arguments: call.function.arguments,
    })),
  });
};
