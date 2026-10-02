import * as App from "@oligarchy/app";
import type * as OpenRouter from "@oligarchy/openrouter";
import * as Qemu from "@oligarchy/qemu-http-tools";
import type * as Stores from "@oligarchy/stores";
import * as jarl from "jarl";
import * as Moves from "./move.ts";
import * as Prompt from "./prompt.ts";
import type * as Types from "./types.ts";

export { ReplyInvalid } from "./move.ts";
export type { Ask, DriveHarness, End, GuestMove, JobHarnessData, Move, Turn } from "./types.ts";

declare module "@oligarchy/app" {
  interface Services {
    driveHarness: App.Register<"driveHarness", Types.DriveHarness>;
  }
}

// The user turn beside the system prompt; the screenshot, when there is one, goes with it.
const ASKING = "Reply with your next tool call.";

// One job's drive. qemuHttpTools is that job's guest; the model sees its tools with step and
// reason added, and Done.
export const create = App.createService<
  Stores.Tests.Tests | Qemu.QemuHttpTools | OpenRouter.OpenRouter,
  App.NoOptions,
  Types.DriveHarness
>(({ tests, qemuHttpTools, openRouter }) => {
  const tools = Moves.tools(qemuHttpTools.tools);

  return {
    service: "driveHarness",
    loadJobHarnessData: async (jobId) => {
      const found = await tests.getJobDetails(jobId);
      if (jarl.is_err(found)) {
        return found;
      }
      const { job, run, definition } = jarl.value(found);
      return jarl.ok({
        jobId: job.id,
        runId: run.id,
        action: job.action,
        name: definition.name,
        description: definition.description,
        instruction: definition.instruction,
        proof: definition.proof,
        iso: run.iso,
        serverUrl: run.serverUrl,
        // Only a resuming drive resumes; a setup always boots fresh.
        resume: job.action === "drive" && definition.resume,
      });
    },
    start: (data) => qemuHttpTools.start({ iso: data.iso, resume: data.resume }),
    // An end whose request was lost leaves the last step's intent open, and refuses every start.
    openStep: async (message) => {
      const opened = await qemuHttpTools.intentStart(message);
      if (!jarl.error.is(opened, Qemu.IntentOpen)) {
        return opened;
      }
      const ended = await qemuHttpTools.intentEnd();
      if (jarl.is_err(ended)) {
        return ended;
      }
      return qemuHttpTools.intentStart(message);
    },
    closeStep: () => qemuHttpTools.intentEnd(),
    prompt: (data, turn) => Prompt.render(data, turn, tools),
    ask: async (request) => {
      const answered = await openRouter.complete({
        model: request.model,
        messages: [
          { role: "system", content: request.prompt },
          {
            role: "user",
            content:
              request.screen === undefined
                ? ASKING
                : [
                    { type: "text", text: ASKING },
                    {
                      type: "image_url",
                      image_url: {
                        url: `data:image/png;base64,${Buffer.from(request.screen).toString("base64")}`,
                      },
                    },
                  ],
          },
        ],
        tools,
        reasoning: request.reasoning,
        deadline: request.deadline,
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      });
      if (jarl.is_err(answered)) {
        return answered;
      }
      return Moves.parse(jarl.value(answered));
    },
    act: (move) => qemuHttpTools.run(move.name, move.arguments),
    finish: (data, end) =>
      data.action === "setup" && end.status === "succeeded"
        ? qemuHttpTools.save()
        : qemuHttpTools.stop(end),
  };
});
