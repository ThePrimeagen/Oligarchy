import type * as App from "@oligarchy/app";
import type * as Http from "@oligarchy/http";
import type * as OpenRouter from "@oligarchy/openrouter";
import type * as Qemu from "@oligarchy/qemu-http-tools";
import type * as Stores from "@oligarchy/stores";
import * as jarl from "jarl";
import * as Moves from "./move.ts";
import * as Prompt from "./prompt.ts";
import type * as Types from "./types.ts";

export { ReplyInvalid } from "./move.ts";
export type { Ask, End, GuestMove, JobHarnessData, Move, Previous } from "./types.ts";

// The user turn beside the system prompt; the screenshot, when there is one, goes with it.
const ASKING = "Reply with your next tool call.";

export type Services = App.Needs<Stores.Tests.Tests | Qemu.QemuHttpTools | OpenRouter.OpenRouter>;

// One drive or setup job's guest and model, and what the model has been shown so far. The driver
// runs the loop and its limits: load, start, then ask and act until the model is done, and
// finish. The driver loads the job before anything else; nothing here checks that it did.
export class DriveHarness {
  readonly services: Services;
  // The guest's tools with step and reason added, and Done.
  readonly tools: ReadonlyArray<OpenRouter.Tool>;
  data!: Types.JobHarnessData;
  // Each move's outcome and each refused reply, in order: the model's past steps.
  readonly reasons: Array<string> = [];
  // What the model last wrote beside its tool call.
  response: string | undefined = undefined;
  // The last move that took no screenshot: what a screenshot shows the result of.
  previous: Types.Previous | undefined = undefined;
  // The last move's screenshot. Any other move may change the screen, so it drops it.
  screen: Uint8Array | undefined = undefined;

  constructor(services: Services) {
    this.services = services;
    this.tools = Moves.tools(services.qemuHttpTools.tools);
  }

  async loadJobHarnessData(jobId: string): Stores.Tests.Found<true> {
    const found = await this.services.tests.getJobDetails(jobId);
    if (jarl.is_err(found)) {
      return found;
    }
    const { job, run, definition } = jarl.value(found);
    this.data = {
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
    };
    return jarl.ok(true);
  }

  start(): Types.Answer<void, Http.HttpFailure> {
    const { iso, resume } = this.data;
    return this.services.qemuHttpTools.start({ iso, resume });
  }

  // A refused reply is the model's next past step, so it sees why.
  async ask(request: Types.Ask): Types.Answer<Types.Move, OpenRouter.Failure | Moves.ReplyInvalid> {
    const prompt = Prompt.render(
      this.data,
      {
        reasons: this.reasons.length === 0 ? "none" : this.reasons.join("\n"),
        ...(this.response === undefined ? {} : { response: this.response }),
        ...(this.previous === undefined ? {} : { previous: this.previous }),
      },
      this.tools,
    );
    const answered = await this.services.openRouter.complete({
      model: request.model,
      messages: [
        { role: "system", content: prompt },
        {
          role: "user",
          content:
            this.screen === undefined
              ? ASKING
              : [
                  { type: "text", text: ASKING },
                  {
                    type: "image_url",
                    image_url: {
                      url: `data:image/png;base64,${Buffer.from(this.screen).toString("base64")}`,
                    },
                  },
                ],
        },
      ],
      tools: this.tools,
      reasoning: request.reasoning,
      deadline: request.deadline,
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    });
    if (jarl.is_err(answered)) {
      return answered;
    }
    const turn = jarl.value(answered);
    this.response = turn.content === null || turn.content.trim() === "" ? undefined : turn.content;
    const move = Moves.parse(turn);
    if (jarl.is_err(move)) {
      this.reasons.push(move.error.message);
    }
    return move;
  }

  // The move's outcome, or why the guest refused it, is the model's next past step.
  async act(move: Types.GuestMove): Types.Answer<Qemu.Ran, Qemu.RunFailure> {
    const ran = await this.services.qemuHttpTools.run(move.name, move.arguments);
    const said = `step ${String(move.step)}: ${move.reason}`;
    if (jarl.is_err(ran)) {
      this.reasons.push(`${said}: ${ran.error.message}`);
      this.screen = undefined;
      return ran;
    }
    const { text, image } = jarl.value(ran);
    this.reasons.push(`${said}: ${text}`);
    this.screen = image;
    if (image === undefined) {
      this.previous = { name: move.name, arguments: move.arguments };
    }
    return ran;
  }

  // A setup that succeeded keeps its disk; anything else stops the guest with its status.
  finish(end: Types.End): Types.Answer<void, Http.HttpFailure | Qemu.NotPoweredOff> {
    return this.data.action === "setup" && end.status === "succeeded"
      ? this.services.qemuHttpTools.save()
      : this.services.qemuHttpTools.stop(end);
  }
}
