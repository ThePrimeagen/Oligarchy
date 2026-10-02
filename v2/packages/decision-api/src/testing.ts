import * as App from "@oligarchy/app";
import * as jarl from "jarl";
import type * as DecisionApi from "./main.ts";
import { decode } from "./response.ts";

type Reply = jarl.Result<DecisionApi.Response, DecisionApi.Failure>;
export type Options = {
  readonly reply: Reply | ((request: DecisionApi.Request) => Reply | Promise<Reply>);
  readonly model?: DecisionApi.Model;
};

// Fakes share the real answer validation: fixtures cannot promise a choice or
// question that the caller never asked for. Any Failure can be returned directly.
export const decisionApi = (
  options: Options,
): {
  readonly "decision-api": App.Made<DecisionApi.DecisionApi>;
  readonly asked: readonly DecisionApi.Request[];
} => {
  const asked: DecisionApi.Request[] = [];
  function decide<const Q extends DecisionApi.Questions>(
    request: DecisionApi.Request<Q>,
  ): Promise<jarl.Result<DecisionApi.Response<Q>, DecisionApi.Failure>>;
  async function decide(request: DecisionApi.Request): Promise<Reply> {
    asked.push(request);
    const reply =
      typeof options.reply === "function" ? await options.reply(request) : options.reply;
    if (jarl.is_err(reply)) return reply;
    const answer = jarl.value(reply);
    return decode(
      {
        success: true,
        errors: [],
        result: {
          model: answer.model,
          answers: answer.answers,
          usage: {
            input_tokens: answer.usage.inputTokens,
            output_tokens: answer.usage.outputTokens,
          },
        },
      },
      request.questions,
      request.model ?? options.model ?? "clef",
    );
  }
  const create = App.createService<never, App.NoOptions, DecisionApi.DecisionApi>(() => ({
    service: "decision-api",
    decide,
  }));
  return { "decision-api": create({}), asked };
};
