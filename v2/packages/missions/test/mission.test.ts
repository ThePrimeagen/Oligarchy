import * as App from "@oligarchy/app";
import * as Db from "@oligarchy/db";
import * as Stores from "@oligarchy/stores";
import * as jarl from "jarl";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as Mission from "../src/mission.ts";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const JOB = "00000000-0000-4000-8000-000000000001";
const RUN = "00000000-0000-4000-8000-000000000002";

const details = (action: Stores.Tests.JobAction, resume: boolean): Stores.Tests.JobDetails => ({
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
    instruction: "Type {{MODEL}}",
    proof: "The desktop is visible",
    resume,
    createdAt: new Date(),
  },
  suite: null,
});

// All unused operations fail immediately. The loader gets only the scripted job lookup.
const services = (getJobDetails: Stores.Tests.Tests["getJobDetails"]) => {
  const unused = (): never => {
    throw new Error("unexpected store call");
  };
  const tests = App.createService<never, App.NoOptions, Stores.Tests.Tests>(() => ({
    service: "tests",
    getJobDetails,
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
  return { tests };
};

it("loads the mission by job id and derives boot mode from its action and definition", async () => {
  for (const [action, resumes, expected] of [
    ["drive", true, true],
    ["drive", false, false],
    ["setup", true, false],
    ["diagnose", true, false],
  ] as const) {
    const getJobDetails = vi.fn(async () => jarl.ok(details(action, resumes)));
    const mission = jarl.unwrap(await Mission.load(services(getJobDetails), { jobId: JOB }));
    expect(getJobDetails).toHaveBeenCalledExactlyOnceWith(JOB);
    expect(mission).toEqual({
      jobId: JOB,
      runId: RUN,
      action,
      name: "install",
      description: "Install and boot",
      instruction: "Type {{MODEL}}",
      proof: "The desktop is visible",
      iso: "https://iso.example/test.iso",
      serverUrl: "http://proxy:42069",
      resume: expected,
    });
  }
});

it("returns the missing job error without making a mission", async () => {
  const error = new Stores.Tests.NotFound("job is missing");
  const result = await Mission.load(
    services(async () => jarl.err(error)),
    { jobId: JOB },
  );
  expect(jarl.error.is(result, Stores.Tests.NotFound)).toBe(true);
  if (jarl.is_err(result)) expect(result.error).toBe(error);
});

it("returns a database failure without making a mission", async () => {
  const error = new Db.DatabaseError("database refused the lookup");
  const result = await Mission.load(
    services(async () => jarl.err(error)),
    { jobId: JOB },
  );
  expect(jarl.error.is(result, Db.DatabaseError)).toBe(true);
  if (jarl.is_err(result)) expect(result.error).toBe(error);
});
