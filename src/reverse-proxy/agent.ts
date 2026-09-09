import { Effect } from "effect";
import * as Prompts from "../ctrl/prompts.ts";
import * as Log from "../observability/log.ts";
import * as Agents from "../shared/agents.ts";
import * as Contract from "../shared/contract.ts";
import * as Domain from "../shared/domain.ts";
import * as Errors from "../shared/errors.ts";

// POST /agent: one agent, handed the prompt its type names, on the model asked for, through
// whichever program the reverse proxy was started with (the config file's word). The agent is told
// its model as the label it must record, so the label is built here from the same choice the
// agent is started on, and "no model" is the program's own default.
export const spawn = Effect.fn("Agent.spawn")(function* (body: Contract.AgentBody) {
  const agents = yield* Agents.Agents;
  const log = yield* Log.Log;
  // A reviewer's task is the session it reads back; a ticket there would cost an agent run to
  // find out, and the line below is attributed to a uuid column.
  if (body.type === "diagnosing-agent" && !Domain.isSessionId(body.task)) {
    return yield* Errors.BadRequest.make({
      message: "task must be a session id for a diagnosing-agent",
    });
  }
  const choice: Domain.ModelChoice = Object.assign(
    body.model === undefined ? { ...agents.defaultModel } : { model: body.model },
    body.reasoning === undefined ? undefined : { reasoning: body.reasoning },
    body.fast === undefined ? undefined : { fast: body.fast },
  );
  const model = Domain.modelLabel(choice);
  const text = yield* (
    body.type === "driving-agent"
      ? Prompts.render("driving-agent.html", { LINEAR_TICKET: body.task, MODEL: model })
      : Prompts.render("diagnosing-agent.html", { SESSION_ID: body.task, MODEL: model })
  ).pipe(Effect.mapError((cause) => Errors.Internal.make({ cause })));
  const started = yield* agents.prompt(text, choice);
  // A driving agent's ticket is the agent id its session will carry; a reviewer's is its session.
  // Where to watch it is its page when the program has one, else the id the program knows it by.
  yield* log.info(
    `agent spawned; ${body.type}; ${body.task}; ${model}; ${started.url ?? started.agentId}`,
    body.type === "driving-agent" ? { agentId: body.task } : { sessionId: body.task },
  );
  return Contract.AgentStarted.make(
    Object.assign(
      { id: started.agentId, model },
      started.url === undefined ? undefined : { url: started.url },
    ),
  );
});
