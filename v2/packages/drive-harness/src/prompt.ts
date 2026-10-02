import type * as OpenRouter from "@oligarchy/openrouter";
import type * as Types from "./types.ts";

// The driving system prompt. <last-response> and <previous-move> are dropped on a turn that has
// neither.
const TEMPLATE = `<role>You drive one guest, one native tool call at a time. You are not a developing agent.</role>

<job-id>{{JOB_ID}}</job-id>
<test-run>{{RUN_ID}}</test-run>
<action>{{ACTION}}</action>

<mission>
  <name>{{TEST_NAME}}</name>
  <description>{{TEST_DESCRIPTION}}</description>
  <def>{{TEST_DEFINITION}}</def>
  <proof>{{TEST_PROOF}}</proof>
</mission>

<progress>
{{PROGRESS}}
</progress>

<last-response>Your last response was: {{RESPONSE}}</last-response>

<previous-move>
  Your previous action was {{PREVIOUS_ACTION}} with values {{PREVIOUS_VALUES}}. When a screenshot
  is provided, it is the result of that action.
</previous-move>

<rules>
  * Reply with one native tool call. Use get_image, get_serial, send_keys or one of the mouse
    tools below to control the guest.
  * Each guest call also carries step, the ActionList line number starting at 1, and reason, that
    line with its leading asterisk and surrounding spaces removed. General crash-reporting and
    screenshot instructions apply throughout and do not add steps.
  * Keep the same step until its action and proof are complete, then add 1. The harness owns these
    fields and removes them before it runs the action.
  * Move the mouse, then take an image and verify its position before clicking. Clicks press at
    the current pointer; a drag starts there and names only its destination. mouse_nudge moves
    0.02 of the screen in a direction.
  * Take screenshots to check each step's result and report crashes or erroneous behavior.
  * Call Done when the last ActionList step and its visible proof are complete. Done takes no
    arguments.
  * Where the mission asks for save or stop, call Done; the harness performs those operations
    after the loop ends.
  * After sending systemctl poweroff, or learning that the guest powered off, your next reply is
    Done. Never request another image of an off guest.
  * The harness starts the guest and manages intents. Do not call host commands or read
    repository files.
</rules>

<tools>{{TOOLS}}</tools>

<machine>
  <user>prime</user>
  <password>prime</password>
  <disk_passphrase>prime</disk_passphrase>
</machine>
`;

const PLACEHOLDER = /\{\{([A-Z_]+)\}\}/g;

const line = (action: Types.Action): string =>
  action.kind === "move"
    ? `- ${action.name} ${JSON.stringify(action.arguments)}: ${action.outcome}`
    : `- refused: ${action.outcome}`;

// The open step's intent, then its newest actions, newest first: `lines` lines in all.
export const progress = (step: Types.Step | undefined, lines: number): string => {
  if (step === undefined) {
    return "No step has started yet.";
  }
  const shown = step.actions.slice(Math.max(0, step.actions.length - (lines - 1)));
  return [`Step ${String(step.step)}: ${step.intent}`, ...shown.reverse().map(line)].join("\n");
};

// One replacement pass: placeholders in instructions, past steps and model replies are data.
export const render = (
  data: Types.JobHarnessData,
  turn: Types.Turn,
  tools: ReadonlyArray<OpenRouter.Tool>,
): string => {
  let text = TEMPLATE;
  if (turn.response === undefined) {
    text = text.replace(/\n*<last-response>[\s\S]*?<\/last-response>/, "");
  }
  if (turn.previous === undefined) {
    text = text.replace(/\n*<previous-move>[\s\S]*?<\/previous-move>/, "");
  }
  const values: Readonly<Record<string, string>> = {
    JOB_ID: data.jobId,
    RUN_ID: data.runId,
    ACTION: data.action,
    TEST_NAME: data.name,
    TEST_DESCRIPTION: data.description,
    TEST_DEFINITION: data.instruction,
    TEST_PROOF: data.proof,
    TOOLS: JSON.stringify(tools),
    PROGRESS: turn.progress,
    RESPONSE: turn.response ?? "",
    PREVIOUS_ACTION: turn.previous?.name ?? "",
    PREVIOUS_VALUES: turn.previous === undefined ? "" : JSON.stringify(turn.previous.arguments),
  };
  return text.replace(PLACEHOLDER, (match: string, key: string) => values[key] ?? match);
};
