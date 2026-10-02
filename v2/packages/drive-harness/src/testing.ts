// Fakes for tests: the harness's services, with the guest behind a fake http, so a test scripts
// what the job, the guest and the model answer and reads every request the guest was sent.
import * as App from "@oligarchy/app";
import type * as Http from "@oligarchy/http";
import * as Fake from "@oligarchy/http/testing";
import type * as OpenRouter from "@oligarchy/openrouter";
import type * as Stores from "@oligarchy/stores";
import * as jarl from "jarl";
import * as DriveHarness from "./main.ts";

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
export const SERVER_URL = "http://proxy:42069";
export const TOKEN = "oligarchy-s3cret";

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
    serverUrl: SERVER_URL,
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

export const screen = (): Response =>
  new Response(SCREEN, { headers: { "Content-Type": "image/png" } });

export const OK = Fake.json({});

// A path the guest answers 409 on, with the proxy's message.
export const conflict = (message: string): Response => Fake.status(409, message);

// Every request the guest was sent, in order, as its path and the fields beside the job.
export type Call = readonly [string] | readonly [string, Readonly<Record<string, unknown>>];

const callOf = (asked: Fake.Asked): Call => {
  const path = new URL(asked.url).pathname.slice(1);
  const body: Readonly<Record<string, unknown>> =
    typeof asked.body === "object" && asked.body !== null ? { ...asked.body } : {};
  const fields = Object.fromEntries(Object.entries(body).filter(([key]) => key !== "job"));
  return Object.keys(fields).length === 0 ? [path] : [path, fields];
};

export type Services = App.Needs<Stores.Tests.Tests | OpenRouter.OpenRouter | Http.Http>;

export type World = {
  readonly calls: ReadonlyArray<Call>;
  readonly asked: ReadonlyArray<Fake.Asked>;
  readonly requests: ReadonlyArray<OpenRouter.Request>;
  readonly services: Services;
  readonly driveHarness: DriveHarness.DriveHarness;
};

type Answered = jarl.Result<OpenRouter.Turn, OpenRouter.Failure>;

// The guest answers each path what `guest` scripts: one reply, or a list in order whose last
// answers every request after it. An image is SCREEN and anything else ok otherwise. The model
// answers `turns` in order, a function one when it is asked; asking past the last throws.
export const world = (
  script: {
    readonly getJobDetails?: Stores.Tests.Tests["getJobDetails"];
    readonly guest?: Readonly<Record<string, Fake.Reply | ReadonlyArray<Fake.Reply>>>;
    readonly turns?: ReadonlyArray<Answered | (() => Answered)>;
    readonly recentActions?: number;
    readonly signal?: AbortSignal;
  } = {},
): World => {
  const calls: Array<Call> = [];
  const requests: Array<OpenRouter.Request> = [];
  const turns = [...(script.turns ?? [])];
  const answered = new Map<string, number>();

  const reply = (asked: Fake.Asked): Fake.Reply => {
    const call = callOf(asked);
    calls.push(call);
    const [path] = call;
    const scripted = script.guest?.[path];
    if (scripted === undefined) {
      return path === "image" ? screen() : OK;
    }
    if (typeof scripted === "string" || scripted instanceof Response) {
      return scripted;
    }
    const at = answered.get(path) ?? 0;
    answered.set(path, at + 1);
    return scripted[Math.min(at, scripted.length - 1)] ?? OK;
  };
  const fake = Fake.http({ replies: reply });

  const tests = App.createService<never, App.NoOptions, Stores.Tests.Tests>(() => ({
    service: "tests",
    ensureSetup: () => {
      throw new Error("unexpected ensureSetup");
    },
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
    timeoutRun: unused,
    abortRun: unused,
    createJob: unused,
    getJob: unused,
    listJobs: unused,
    listRunningJobs: unused,
    completeDrive: unused,
    completeDiagnosis: unused,
    timeoutJobAndRun: unused,
    latestJob: unused,
    nextPendingJob: unused,
    runJob: unused,
    completeJob: unused,
    finalizeJob: unused,
    errorJob: unused,
    timeoutJob: unused,
    abortJob: unused,
  }))({});

  const openRouter = App.createService<never, App.NoOptions, OpenRouter.OpenRouter>(() => ({
    service: "openRouter",
    complete: async (request) => {
      requests.push(request);
      const next = turns.shift();
      if (next === undefined) {
        throw new Error("the model was asked once too often");
      }
      return typeof next === "function" ? next() : next;
    },
  }))({});

  const services = { tests, openRouter, http: fake.http };
  const driveHarness = DriveHarness.create(
    services,
    script.signal ?? new AbortController().signal,
    {
      recentActions: script.recentActions ?? 10,
      job: JOB,
      baseUrl: SERVER_URL,
      token: { reveal: () => TOKEN },
      startTimeoutMs: 90_000,
      saveTimeoutMs: 30_000,
    },
  );
  return { calls, asked: fake.asked, requests, services, driveHarness };
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
