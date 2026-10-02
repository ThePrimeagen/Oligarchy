import { readFileSync } from "node:fs";
import * as Db from "@oligarchy/db";
import * as Env from "@oligarchy/env";
import * as FakePostgres from "@oligarchy/fake-postgres";
import * as QemuHttpTools from "@oligarchy/qemu-http-tools";
import * as Stores from "@oligarchy/stores";
import * as jarl from "jarl";
import { afterEach, describe, expect, it } from "vitest";
import * as Prompts from "../src/prompts.ts";

const ISO = "https://iso.omarchy.org/omarchy-4.0.4.iso";
const PROXY = "http://127.0.0.1:42069";
const QEMU_SERVER = "http://10.0.0.5:4000";
const MISSING_JOB = "00000000-0000-4000-8000-000000000000";

const CONFIG = readFileSync(Env.CONFIG_PATH, "utf8");

const MISSION = {
  description: "Locks the screen and unlocks it again",
  // A mission's own braces are its words, never a placeholder of the prompt's.
  instruction: "* press super+L\n* type {{PASSWORD}} and press enter",
  proof: "the desktop is back",
};

const cleanups: Array<() => Promise<unknown>> = [];

afterEach(async () => {
  for (let cleanup = cleanups.pop(); cleanup !== undefined; cleanup = cleanups.pop()) {
    await cleanup();
  }
});

const real = (...paths: ReadonlyArray<string>): Record<string, string> =>
  Object.fromEntries(paths.map((path) => [path, readFileSync(path, "utf8")]));

const placeholders = (text: string): ReadonlyArray<string> => text.match(/\{\{[A-Z_]+\}\}/g) ?? [];

// A migrated database of the test's own with the tests store over it, and the prompts read
// through io: the files handed in, nothing else.
const prompting = async () => {
  const fake = jarl.unwrap(await FakePostgres.start());
  cleanups.push(() => fake.stop());
  const env = jarl.unwrap(
    await Env.create(
      Env.cli({ name: "prompts-test", description: "" }).needs("databaseUrl").done(),
      Env.fakeIo({ env: { DATABASE_URL: fake.url }, files: { [Env.CONFIG_PATH]: CONFIG } }),
    ),
  );
  const db = Db.create({}, { url: env.vars.databaseUrl });
  cleanups.push(() => db.close());
  const tests = Stores.Tests.create({ db });
  const setupRequests = Stores.SetupRequests.create({ db });
  const { models } = env.config;

  const define = async (name: string) =>
    jarl.unwrap(await tests.defineTestDefinition({ name, ...MISSION, resume: true })).id;
  const drive = async () =>
    jarl.unwrap(
      await tests.createTestRun({
        definitionId: await define("lock-screen"),
        iso: ISO,
        serverUrl: PROXY,
      }),
    );
  const setup = async () => {
    jarl.unwrap(await setupRequests.insert(ISO, QEMU_SERVER));
    return jarl.unwrap(
      await tests.createTestRun({
        definitionId: await define("setup"),
        iso: ISO,
        serverUrl: PROXY,
        setupServer: QEMU_SERVER,
      }),
    );
  };
  // A diagnose on a test run whose drive was aborted to make way for it.
  const diagnose = async () => {
    const filed = await drive();
    jarl.unwrap(await tests.abortJob(filed.job.id, "making way"));
    return {
      run: filed.run,
      job: jarl.unwrap(await tests.createJob(filed.run.id, "diagnose")),
    };
  };
  const forJob = async (jobId: string, files: Parameters<typeof Env.fakeIo>[0] = {}) => {
    const io = Env.fakeIo(files);
    const prompt = await Prompts.create({ tests }, { readFile: io.readFile, models }).forJob(jobId);
    return { prompt, reads: io.reads };
  };

  return { fake, models, drive, setup, diagnose, forJob };
};

describe("a job's prompt", () => {
  it.each([
    { action: "drive", name: "lock-screen" },
    { action: "setup", name: "setup" },
  ] as const)(
    "a $action is told its job id, its action's model, the harness's tools and its definition's mission, its own braces as written, reading the driving template alone (happy)",
    async ({ action, name }) => {
      const at = await prompting();
      const { job } = action === "drive" ? await at.drive() : await at.setup();

      const { prompt, reads } = await at.forJob(job.id, {
        files: real(Prompts.DRIVING, Prompts.DIAGNOSING),
      });

      const text = jarl.unwrap(prompt);
      expect(text).toContain(`<agent-id> ${job.id} </agent-id>`);
      expect(text).toContain(`<model> ${at.models[action]} </model>`);
      for (const tool of QemuHttpTools.definitions) {
        expect(text).toContain(tool.function.name);
      }
      expect(text).toContain(`<name>${name}</name>`);
      expect(text).toContain(`<description>${MISSION.description}</description>`);
      expect(text).toContain(`<instruction>${MISSION.instruction}</instruction>`);
      expect(text).toContain(`<proof>${MISSION.proof}</proof>`);
      expect(text).not.toContain("./client");
      expect(placeholders(text)).toEqual(["{{PASSWORD}}"]);
      expect(reads).toEqual([Prompts.DRIVING]);
    },
  );

  it("a diagnose is told its job id, its test run's id, the diagnose model and the ctrl guide (happy)", async () => {
    const at = await prompting();
    const { run, job } = await at.diagnose();
    const files = real(Prompts.DRIVING, Prompts.DIAGNOSING, Prompts.CTRL_DIAGNOSE);

    const { prompt, reads } = await at.forJob(job.id, { files });

    const text = jarl.unwrap(prompt);
    expect(text).toContain(`<job_id>${job.id}</job_id>`);
    expect(text).toContain(`<test_run_id>${run.id}</test_run_id>`);
    expect(text).toContain(`<model>${at.models.diagnose}</model>`);
    expect(text).toContain(files[Prompts.CTRL_DIAGNOSE]?.trimEnd());
    expect(placeholders(text)).toEqual([]);
    expect(reads).toEqual([Prompts.DIAGNOSING, Prompts.CTRL_DIAGNOSE]);
  });

  it("a job that does not exist is not found, and no template is read (unhappy)", async () => {
    const at = await prompting();

    const { prompt, reads } = await at.forJob(MISSING_JOB, {
      files: real(Prompts.DRIVING, Prompts.DIAGNOSING),
    });

    expect(jarl.error.is(prompt, Stores.Tests.NotFound)).toBe(true);
    expect(reads).toEqual([]);
  });

  it("a database that cannot be reached is its error, and no template is read (unhappy)", async () => {
    const at = await prompting();
    const { job } = await at.drive();
    await at.fake.stop();

    const { prompt, reads } = await at.forJob(job.id, {
      files: real(Prompts.DRIVING, Prompts.DIAGNOSING),
    });

    expect(jarl.error.is(prompt, Db.DatabaseError)).toBe(true);
    expect(reads).toEqual([]);
  });

  it("a template that is missing is FileMissing naming its path (unhappy)", async () => {
    const at = await prompting();
    const { job } = await at.drive();

    const { prompt } = await at.forJob(job.id);

    expect(jarl.error.is(prompt, Env.FileMissing)).toBe(true);
    if (jarl.error.is(prompt, Env.FileMissing)) {
      expect(prompt.error.path).toBe(Prompts.DRIVING);
    }
  });

  it("a guide the template names that cannot be read is FileUnreadable naming its path (unhappy)", async () => {
    const at = await prompting();
    const { job } = await at.diagnose();

    const { prompt, reads } = await at.forJob(job.id, {
      files: real(Prompts.DIAGNOSING, Prompts.CTRL_DIAGNOSE),
      unreadable: [Prompts.CTRL_DIAGNOSE],
    });

    expect(jarl.error.is(prompt, Env.FileUnreadable)).toBe(true);
    if (jarl.error.is(prompt, Env.FileUnreadable)) {
      expect(prompt.error.path).toBe(Prompts.CTRL_DIAGNOSE);
    }
    expect(reads).toEqual([Prompts.DIAGNOSING, Prompts.CTRL_DIAGNOSE]);
  });

  it("a template naming a placeholder with no value is PromptUnfilled naming the template and the first such placeholder (unhappy)", async () => {
    const at = await prompting();
    const { job } = await at.drive();

    const { prompt } = await at.forJob(job.id, {
      files: { [Prompts.DRIVING]: "{{JOB_ID}} {{NOPE}} {{ALSO}}" },
    });

    expect(jarl.error.is(prompt, Prompts.PromptUnfilled)).toBe(true);
    if (jarl.error.is(prompt, Prompts.PromptUnfilled)) {
      expect(prompt.error.message).toBe(
        "prompt: driving-agent.html uses {{NOPE}}, which has no value",
      );
    }
  });
});
