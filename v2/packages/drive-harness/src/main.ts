import type * as App from "@oligarchy/app";
import type * as Db from "@oligarchy/db";
import type * as Http from "@oligarchy/http";
import type * as OpenRouter from "@oligarchy/openrouter";
import type * as Qemu from "@oligarchy/qemu-http-tools";
import type * as Stores from "@oligarchy/stores";
import * as jarl from "jarl";
import * as Moves from "./move.ts";
import * as Prompt from "./prompt.ts";
import * as Steps from "./steps.ts";
import type * as Types from "./types.ts";

export { ReplyInvalid } from "./move.ts";
export type {
  Action,
  Ask,
  End,
  GuestMove,
  JobHarnessData,
  Move,
  Options,
  Previous,
  Step,
} from "./types.ts";

// The user turn beside the system prompt; the screenshot, when there is one, goes with it.
const ASKING = "Reply with your next tool call.";

export type Services = App.Needs<
  Stores.Tests.Tests | Stores.Moves.Moves | Qemu.QemuHttpTools | OpenRouter.OpenRouter
>;

// One drive or setup job's guest and model, and what the model has been shown so far. The driver
// runs the loop and its limits: load and start, then each turn getImage, ask and act until the
// model is done, and finish. The driver loads the job before anything else; nothing here checks
// that it did.
export class DriveHarness {
  readonly services: Services;
  readonly options: Types.Options;
  // The guest's tools with step and reason added, and Done.
  readonly tools: ReadonlyArray<OpenRouter.Tool>;
  data!: Types.JobHarnessData;
  // The ActionList's lines: step N's intent is line N.
  lines: ReadonlyArray<string> = [];
  // Every step opened, each with all its actions; the last is the current one.
  readonly steps: Array<Types.Step> = [];
  // Whether the current step's intent is open on the guest.
  intentOpen = false;
  // What the model last wrote beside its tool call.
  response: string | undefined = undefined;
  // The last move that took no screenshot: what a screenshot shows the result of.
  previous: Types.Previous | undefined = undefined;
  // The screen the next ask shows. Any move that took none may have changed it, so it drops it.
  screen: Uint8Array | undefined = undefined;

  constructor(services: Services, options: Types.Options) {
    this.services = services;
    this.options = options;
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
    this.lines = Steps.stepsOf(definition.instruction);
    return jarl.ok(true);
  }

  start(): Types.Answer<void, Http.HttpFailure> {
    const { iso, resume } = this.data;
    return this.services.qemuHttpTools.start({ iso, resume });
  }

  // 1. The guest's screen, for the next ask.
  async getImage(): Types.Answer<void, Http.HttpFailure | Qemu.GuestOff> {
    const image = await this.services.qemuHttpTools.image();
    if (jarl.is_err(image)) {
      this.screen = undefined;
      return image;
    }
    this.screen = jarl.value(image);
    return jarl.ok(undefined);
  }

  // 2. The prompt, from what the model has been shown so far, and the model's turn.
  async ask(request: Types.Ask): Types.Answer<OpenRouter.Turn, OpenRouter.Failure> {
    const prompt = Prompt.render(
      this.data,
      {
        progress: Prompt.progress(this.steps.at(-1), this.options.recentActions),
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
    return answered;
  }

  // 3. The turn's one tool call, run under its step. A move for a step that is not open opens it
  // first, and runs nothing when it cannot. What came of the move, or of a refused reply, is kept
  // under the open step and recorded for the job; a record that failed is returned in its place.
  async act(
    turn: OpenRouter.Turn,
  ): Types.Answer<
    Types.Move,
    Moves.ReplyInvalid | Qemu.RunFailure | Http.HttpFailure | Qemu.IntentOpen | Db.DatabaseError
  > {
    const move = Moves.parse(turn);
    if (jarl.is_err(move)) {
      const open = this.steps.at(-1);
      open?.actions.push({ kind: "refused", outcome: move.error.message });
      const recorded = await this.services.moves.recordMove({
        jobId: this.data.jobId,
        kind: "refused",
        step: open?.step ?? null,
        outcome: move.error.message,
      });
      return jarl.is_err(recorded) ? recorded : move;
    }
    const parsed = jarl.value(move);
    if (parsed.kind === "done") {
      return move;
    }
    if (!this.intentOpen || this.steps.at(-1)?.step !== parsed.step) {
      const opened = await this.nextStep(parsed.step);
      if (jarl.is_err(opened)) {
        return opened;
      }
    }
    const ran = await this.services.qemuHttpTools.run(parsed.name, parsed.arguments);
    const done = {
      kind: "move",
      name: parsed.name,
      reason: parsed.reason,
      arguments: parsed.arguments,
    } as const;
    const { text: outcome, image } = jarl.is_err(ran)
      ? { text: ran.error.message, image: undefined }
      : jarl.value(ran);
    this.screen = image;
    if (jarl.is_ok(ran) && image === undefined) {
      this.previous = { name: parsed.name, arguments: parsed.arguments };
    }
    this.steps.at(-1)?.actions.push({ ...done, outcome });
    const recorded = await this.services.moves.recordMove({
      jobId: this.data.jobId,
      step: parsed.step,
      ...done,
      outcome,
    });
    if (jarl.is_err(recorded)) {
      return recorded;
    }
    return jarl.is_err(ran) ? ran : move;
  }

  // 4. Ends the open step's intent and starts this one's, named after its ActionList line. A step
  // whose intent did not start is not opened.
  async nextStep(step: number): Types.Answer<void, Http.HttpFailure | Qemu.IntentOpen> {
    if (this.intentOpen) {
      const ended = await this.services.qemuHttpTools.intentEnd();
      if (jarl.is_err(ended)) {
        return ended;
      }
      this.intentOpen = false;
    }
    const intent = this.lines[step - 1] ?? `step ${String(step)}`;
    const started = await this.services.qemuHttpTools.intentStart(intent);
    if (jarl.is_err(started)) {
      return started;
    }
    this.intentOpen = true;
    this.steps.push({ step, intent, actions: [] });
    return started;
  }

  // A setup that succeeded keeps its disk; anything else stops the guest with its status.
  finish(end: Types.End): Types.Answer<void, Http.HttpFailure | Qemu.NotPoweredOff> {
    return this.data.action === "setup" && end.status === "succeeded"
      ? this.services.qemuHttpTools.save()
      : this.services.qemuHttpTools.stop(end);
  }
}
