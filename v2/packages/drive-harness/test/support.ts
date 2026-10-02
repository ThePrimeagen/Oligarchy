import * as App from "@oligarchy/app";
import type * as OpenRouter from "@oligarchy/openrouter";
import type * as Qemu from "@oligarchy/qemu-http-tools";
import type * as Stores from "@oligarchy/stores";
import * as jarl from "jarl";
import * as DriveHarness from "../src/main.ts";

export const JOB = "00000000-0000-4000-8000-000000000001";
// Two steps; the trailing crash line holds for the whole run and is not one.
export const INSTRUCTION = [
  "Lock the screen and unlock it.",
  "<ActionList>",
  "* Type {{MODEL}}",
  "*   Look at the desktop  ",
  "* any crashes or erroneous behavior must be reported",
  "</ActionList>",
].join("\n");
export const RUN = "00000000-0000-4000-8000-000000000002";

export const details = (
  action: Stores.Tests.JobAction,
  resume: boolean,
): Stores.Tests.JobDetails => ({
  job: {
    id: JOB,
    runId: RUN,
    action,
    status: "running",
    reason: null,
    serverId: null,
    createdAt: new Date(),
    startedAt: new Date(),
    finishedAt: null,
  },
  run: {
    id: RUN,
    suiteId: null,
    definitionId: 1,
    iso: "https://iso.example/test.iso",
    serverUrl: "http://proxy:42069",
    model: null,
    status: "pending",
    reason: null,
    createdAt: new Date(),
    finishedAt: null,
  },
  definition: {
    id: 1,
    name: "install",
    description: "Install and boot",
    instruction: INSTRUCTION,
    proof: "The desktop is visible",
    resume,
    createdAt: new Date(),
  },
  suite: null,
});

export const SCREEN = new Uint8Array([1, 2]);

const unused = (): never => {
  throw new Error("unexpected call");
};

export const SEND_KEYS: OpenRouter.Tool = {
  type: "function",
  function: {
    name: "send_keys",
    description: "Type into the guest.",
    parameters: {
      type: "object",
      properties: { keys: { type: "string", minLength: 1 } },
      required: ["keys"],
      additionalProperties: false,
    },
  },
};

type Guest = Pick<
  Qemu.QemuHttpTools,
  "start" | "image" | "intentStart" | "intentEnd" | "stop" | "save" | "run"
>;

const ok = async () => jarl.ok(undefined);

// Every call the harness makes on the guest, in order, as [name, ...arguments].
export type Call = readonly [string, ...ReadonlyArray<unknown>];

export type World = {
  readonly calls: Array<Call>;
  readonly requests: Array<OpenRouter.Request>;
  // Every move the harness asked to record, in order, whether or not the record landed.
  readonly moved: Array<Stores.Moves.MoveInput>;
  readonly harness: DriveHarness.DriveHarness;
};

// Each guest call answers what `guest` scripts, and ok otherwise. The model answers `turns` in
// order; asking past the last is a test failure.
export const world = (
  script: {
    readonly getJobDetails?: Stores.Tests.Tests["getJobDetails"];
    readonly guest?: Partial<Guest>;
    readonly turns?: ReadonlyArray<jarl.Result<OpenRouter.Turn, OpenRouter.Failure>>;
    readonly recentActions?: number;
    readonly recordMove?: Stores.Moves.Moves["recordMove"];
  } = {},
): World => {
  const calls: Array<Call> = [];
  const requests: Array<OpenRouter.Request> = [];
  const moved: Array<Stores.Moves.MoveInput> = [];
  const turns = [...(script.turns ?? [])];
  const guest = script.guest ?? {};
  const recorded =
    <A extends ReadonlyArray<unknown>, R>(name: string, act: (...args: A) => R) =>
    (...args: A): R => {
      calls.push([name, ...args]);
      return act(...args);
    };

  const tests = App.createService<never, App.NoOptions, Stores.Tests.Tests>(() => ({
    service: "tests",
    getJobDetails: script.getJobDetails ?? (async () => jarl.ok(details("drive", true))),
    listTestDefinitions: unused,
    findTestDefinition: unused,
    listTestDefinitionHistory: unused,
    defineTestDefinition: unused,
    listTestBasePrompts: unused,
    definitionName: unused,
    createTestSuite: unused,
    getTestSuite: unused,
    getTestSuiteDetails: unused,
    listTestSuites: unused,
    completeSuite: unused,
    abortSuite: unused,
    createTestRun: unused,
    getTestRun: unused,
    getTestRunDetails: unused,
    listTestRuns: unused,
    startRun: unused,
    completeRun: unused,
    errorRun: unused,
    abortRun: unused,
    createJob: unused,
    getJob: unused,
    listJobs: unused,
    latestJob: unused,
    nextPendingJob: unused,
    runJob: unused,
    completeJob: unused,
    finalizeJob: unused,
    errorJob: unused,
    timeoutJob: unused,
    abortJob: unused,
  }))({});

  const qemuHttpTools = App.createService<never, App.NoOptions, Qemu.QemuHttpTools>(() => ({
    service: "qemuHttpTools",
    start: recorded("start", guest.start ?? ok),
    image: recorded("image", guest.image ?? (async () => jarl.ok(SCREEN))),
    serial: unused,
    sendKeys: unused,
    mouse: {
      at: unused,
      move: unused,
      nudge: unused,
      click: unused,
      doubleClick: unused,
      drag: unused,
      scroll: unused,
      hold: unused,
      release: unused,
    },
    intentStart: recorded("intentStart", guest.intentStart ?? ok),
    intentEnd: recorded("intentEnd", guest.intentEnd ?? ok),
    stop: recorded("stop", guest.stop ?? ok),
    save: recorded("save", guest.save ?? ok),
    tools: [SEND_KEYS],
    run: recorded("run", guest.run ?? (async () => jarl.ok({ text: "sent the keys" }))),
  }))({});

  const openRouter = App.createService<never, App.NoOptions, OpenRouter.OpenRouter>(() => ({
    service: "openRouter",
    complete: async (request) => {
      requests.push(request);
      const next = turns.shift();
      if (next === undefined) {
        throw new Error("the model was asked once too often");
      }
      return next;
    },
  }))({});

  const moves = App.createService<never, App.NoOptions, Stores.Moves.Moves>(() => ({
    service: "moves",
    recordMove: async (input) => {
      moved.push(input);
      return script.recordMove === undefined ? jarl.ok(undefined) : script.recordMove(input);
    },
  }))({});

  const harness = new DriveHarness.DriveHarness(
    { tests, qemuHttpTools, openRouter, moves },
    { recentActions: script.recentActions ?? 10 },
  );
  return { calls, requests, moved, harness };
};

// One tool call, with the model's text beside it.
export const turn = (
  name: string,
  args: Readonly<Record<string, unknown>> | string,
  content: string | null = null,
): OpenRouter.Turn => ({
  content,
  toolCalls: [
    { id: "call-1", name, arguments: typeof args === "string" ? args : JSON.stringify(args) },
  ],
});

// The model answering that one tool call.
export const said = (...args: Parameters<typeof turn>): jarl.Result<OpenRouter.Turn, never> =>
  jarl.ok(turn(...args));

// The system prompt and the user turn of each request, as the model read them.
export const shown = (request: OpenRouter.Request | undefined) => {
  const [system, user] = request?.messages ?? [];
  return {
    prompt: system?.role === "system" ? system.content : "",
    user: user?.role === "user" ? user.content : "",
  };
};
