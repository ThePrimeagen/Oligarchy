import type * as OpenRouter from "@oligarchy/openrouter";
import * as jarl from "jarl";
import type * as Types from "./types.ts";

// The model's turn is not one move the harness can take. Nothing was sent to the guest.
export const ReplyInvalid = jarl.error.define("ReplyInvalid");
export type ReplyInvalid = InstanceType<typeof ReplyInvalid>;

const STEP = {
  type: "integer",
  minimum: 1,
  description: "The number of the ActionList line this action works on, from 1",
};
const REASON = {
  type: "string",
  minLength: 1,
  description: "That ActionList line, without its leading asterisk",
};

const DONE: OpenRouter.Tool = {
  type: "function",
  function: {
    name: "Done",
    description: "Finish the driving loop so the harness can save or stop the guest.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
};

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// Every guest tool also takes step and reason, which the harness takes out before it runs one.
export const tools = (guest: ReadonlyArray<OpenRouter.Tool>): ReadonlyArray<OpenRouter.Tool> => [
  ...guest.map((tool) => {
    const { properties, required } = tool.function.parameters;
    return {
      ...tool,
      function: {
        ...tool.function,
        parameters: {
          ...tool.function.parameters,
          properties: { ...(isRecord(properties) ? properties : {}), step: STEP, reason: REASON },
          required: [...(Array.isArray(required) ? required : []), "step", "reason"],
        },
      },
    };
  }),
  DONE,
];

const invalid = (message: string) => jarl.err(new ReplyInvalid(`reply: ${message}`));

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

// Some providers send a call with no arguments as an empty string.
const argumentsOf = (call: OpenRouter.ToolCall) => {
  const parsed = call.arguments.trim() === "" ? {} : parseJson(call.arguments);
  return isRecord(parsed)
    ? jarl.ok(parsed)
    : invalid(`${call.name}: arguments are not a JSON object`);
};

export const parse = (turn: OpenRouter.Turn): jarl.Result<Types.Move, ReplyInvalid> => {
  const [call, ...more] = turn.toolCalls;
  if (call === undefined || more.length > 0) {
    return invalid(`expected one tool call, got ${String(turn.toolCalls.length)}`);
  }
  const parsedArgs = argumentsOf(call);
  if (jarl.is_err(parsedArgs)) {
    return parsedArgs;
  }
  const args = jarl.value(parsedArgs);
  if (call.name === DONE.function.name) {
    return Object.keys(args).length === 0
      ? jarl.ok({ kind: "done" })
      : invalid("Done takes no arguments");
  }
  const { step, reason, ...own } = args;
  if (typeof step !== "number" || !Number.isInteger(step) || step < 1) {
    return invalid(`${call.name}: step is the ActionList line, a whole number from 1`);
  }
  if (typeof reason !== "string" || reason.trim() === "") {
    return invalid(`${call.name}: reason is that ActionList line`);
  }
  return jarl.ok({ kind: "guest", step, reason: reason.trim(), name: call.name, arguments: own });
};
