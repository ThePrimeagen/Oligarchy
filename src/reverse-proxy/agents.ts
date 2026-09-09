import { Effect } from "effect";
import * as Cursor from "../ctrl/cursor.ts";
import * as Prompts from "../ctrl/prompts.ts";
import * as Log from "../observability/log.ts";
import * as Contract from "../shared/contract.ts";
import * as Domain from "../shared/domain.ts";
import * as Errors from "../shared/errors.ts";

// POST /agent: one cloud agent, handed the prompt its type names, on the model asked for. The
// agent is told its model as the label it must record, so the label is built here from the same
// choice the agent is started on. Another way of spawning is another CursorAgents layer.
export const spawn = Effect.fn("Agents.spawn")(function* (body: Contract.AgentBody) {
  const agents = yield* Cursor.CursorAgents;
  const log = yield* Log.Log;
  // A reviewer's task is the session it reads back; a ticket there would cost an agent run to
  // find out, and the line below is attributed to a uuid column.
  if (body.type === "diagnosing-agent" && !Domain.isSessionId(body.task)) {
    return yield* Errors.BadRequest.make({
      message: "task must be a session id for a diagnosing-agent",
    });
  }
  // No model means the default; reasoning and fast in the body still say their piece.
  const choice: Domain.ModelChoice = Object.assign(
    body.model === undefined ? { ...Domain.DEFAULT_MODEL } : { model: body.model },
    body.reasoning === undefined ? undefined : { reasoning: body.reasoning },
    body.fast === undefined ? undefined : { fast: body.fast },
  );
  const model = Domain.modelLabel(choice);
  const text = yield* (
    body.type === "driving-agent"
      ? Prompts.render("driving-agent.html", { LINEAR_TICKET: body.task, MODEL: model })
      : Prompts.render("diagnosing-agent.html", { SESSION_ID: body.task, MODEL: model })
  ).pipe(Effect.mapError((cause) => Errors.Internal.make({ cause })));
  const { agentId } = yield* agents.prompt(text, choice);
  const url = Cursor.agentUrl(agentId);
  // A driving agent's ticket is the agent id its session will carry; a reviewer's is its session.
  yield* log.info(
    `agent spawned; ${body.type}; ${body.task}; ${model}; ${url}`,
    body.type === "driving-agent" ? { agentId: body.task } : { sessionId: body.task },
  );
  return Contract.AgentStarted.make({ id: agentId, url, model });
});
