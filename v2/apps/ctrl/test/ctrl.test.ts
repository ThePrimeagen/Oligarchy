import { readFileSync } from "node:fs";
import * as Env from "@oligarchy/env";
import * as FakePostgres from "@oligarchy/fake-postgres";
import * as jarl from "jarl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Commands from "../src/commands.ts";
import { environment } from "../src/environment.ts";
import { closeServices, createServices } from "../src/services.ts";

const ISO = "https://iso.omarchy.org/omarchy-4.0.4.iso";
const PROXY = "http://127.0.0.1:42069";
const CLIENT = "11111111-1111-4111-8111-111111111111";
const IMAGE = "22222222-2222-4222-8222-222222222222";
const MISSING = "00000000-0000-4000-8000-000000000000";
const MODEL = "muse-spark-1.3";
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

const CONFIG = readFileSync(Env.CONFIG_PATH, "utf8");

const cleanups: Array<() => Promise<unknown>> = [];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
});

afterEach(async () => {
  vi.useRealTimers();
  for (let cleanup = cleanups.pop(); cleanup !== undefined; cleanup = cleanups.pop()) {
    await cleanup();
  }
});

type Ran = {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
};

const parsed = (url: string, argv: ReadonlyArray<string>) =>
  Env.create(
    environment,
    Env.fakeIo({ argv, env: { DATABASE_URL: url }, files: { [Env.CONFIG_PATH]: CONFIG } }),
  );

// ctrl's services over the database at url, and ctrl(), which runs one command line over them as
// main does, keeping stdout, stderr and the files it writes.
const ctrlAt = async (url: string, writeFile: Commands.Output["writeFile"]) => {
  const services = createServices(jarl.unwrap(await parsed(url, ["logs", "--job-id", MISSING])));
  cleanups.push(() => closeServices(services));
  const ctrl = async (...argv: ReadonlyArray<string>): Promise<Ran> => {
    let stdout = "";
    let stderr = "";
    const code = await Commands.run(services, jarl.unwrap(await parsed(url, argv)), {
      stdout: (text) => {
        stdout += text;
      },
      stderr: (text) => {
        stderr += text;
      },
      writeFile,
    });
    return { code, stdout, stderr };
  };
  return { services, ctrl };
};

// A migrated database of the test's own, ctrl over it, and the jobs a test reviews.
const ctrlOver = async () => {
  const fake = jarl.unwrap(await FakePostgres.start());
  cleanups.push(() => fake.stop());
  const files = new Map<string, Uint8Array>();
  let writeFile: Commands.Output["writeFile"] = async (path, data) => {
    files.set(path, data);
  };
  const { services, ctrl } = await ctrlAt(fake.url, (path, data) => writeFile(path, data));
  const failWrites = (thrown: Error) => {
    writeFile = async () => {
      throw thrown;
    };
  };

  const { tests, actions, diagnosis } = services;
  const definition = jarl.unwrap(
    await tests.defineTestDefinition({
      name: "lock-screen",
      description: "Locks the screen",
      instruction: "Lock the screen with Super+Ctrl+L",
      proof: "The lock screen asks for the password",
      resume: true,
    }),
  );
  // A drive on a test run of its own, claimed by a client: running until completed.
  const runningDrive = async () => {
    const { run, job } = jarl.unwrap(
      await tests.createTestRun({ definitionId: definition.id, iso: ISO, serverUrl: PROXY }),
    );
    jarl.unwrap(await tests.runJob(job.id, CLIENT));
    return { run, job };
  };
  const completedDrive = async () => {
    const filed = await runningDrive();
    jarl.unwrap(await tests.completeJob(filed.job.id));
    return filed;
  };
  // The diagnose job judging a completed drive, itself completed.
  const diagnoseJob = async () => {
    const { run } = await completedDrive();
    const judging = jarl.unwrap(await tests.createJob(run.id, "diagnose"));
    jarl.unwrap(await tests.runJob(judging.id, CLIENT));
    return jarl.unwrap(await tests.completeJob(judging.id));
  };
  const existingType = async () =>
    jarl.unwrap(await diagnosis.createErrorType("lock_screen_missed", "The lock never showed"));
  const stored = async (jobId: string) => ({
    diagnosis: jarl.unwrap(await diagnosis.getDiagnosis(jobId)),
    errorTypes: jarl.unwrap(await diagnosis.listErrorTypes()).map((type) => type.key),
  });
  return {
    services,
    actions,
    files,
    ctrl,
    failWrites,
    runningDrive,
    completedDrive,
    diagnoseJob,
    existingType,
    stored,
  };
};

const failed = (key: string) => ["--verdict", "failed", "--type", key] as const;
const told = ["--summary", "The lock screen never showed", "--model", MODEL] as const;

describe("ctrl", () => {
  it("prints a job's evidence, writes its image and records a verdict with a new error type (happy)", async () => {
    const { services, files, ctrl, completedDrive, existingType, stored } = await ctrlOver();
    const { run, job } = await completedDrive();
    const action = jarl.unwrap(
      await services.actions.startAction({ jobId: job.id, request: { tool: "send_keys" } }),
    );
    jarl.unwrap(
      await services.actions.finishAction(
        action,
        { state: "completed", response: { sent: true } },
        { id: IMAGE, data: PNG },
      ),
    );
    await existingType();

    const logs = await ctrl("logs", "--job-id", job.id);

    expect(logs).toMatchObject({ code: 0, stderr: "" });
    const shown: unknown = JSON.parse(logs.stdout);
    expect(Object.keys(JSON.parse(logs.stdout))).toEqual([
      "job",
      "run",
      "suite",
      "definition",
      "vmStatus",
      "intents",
      "actions",
      "images",
      "debugLog",
      "diagnosis",
      "errorTypes",
    ]);
    expect(shown).toMatchObject({
      job: { id: job.id, action: "drive", status: "completed" },
      run: { id: run.id, iso: ISO },
      suite: null,
      definition: { name: "lock-screen", proof: "The lock screen asks for the password" },
      actions: [{ id: action, request: { tool: "send_keys" }, state: "completed" }],
      images: [{ id: IMAGE, actionId: action }],
      debugLog: null,
      diagnosis: null,
      errorTypes: [{ key: "lock_screen_missed", description: "The lock never showed" }],
    });

    const image = await ctrl("image", "--image-id", IMAGE, "--output", "last.png");

    expect(image).toMatchObject({ code: 0, stderr: "" });
    expect([...files.keys()]).toEqual(["last.png"]);
    expect([...(files.get("last.png") ?? [])]).toEqual([...PNG]);

    const diagnosed = await ctrl(
      "diagnose",
      "--job-id",
      job.id,
      ...failed("lock_never_engaged"),
      "--description",
      "Super+Ctrl+L sent and the desktop stayed",
      ...told,
    );

    expect(diagnosed).toMatchObject({ code: 0, stderr: "" });
    const after = await stored(job.id);
    expect(after.errorTypes).toEqual(["lock_never_engaged", "lock_screen_missed"]);
    expect(jarl.unwrap(await services.diagnosis.findErrorType("lock_never_engaged"))).toMatchObject(
      { description: "Super+Ctrl+L sent and the desktop stayed" },
    );
    expect(after.diagnosis).toMatchObject({
      jobId: job.id,
      verdict: "failed",
      errorType: "lock_never_engaged",
      summary: "The lock screen never showed",
      model: MODEL,
    });
  });

  describe("logs", () => {
    it("refuses a job that does not exist, naming it (unhappy)", async () => {
      const { ctrl } = await ctrlOver();

      const ran = await ctrl("logs", "--job-id", MISSING);

      expect(ran.code).toBe(1);
      expect(ran.stdout).toBe("");
      expect(ran.stderr).toContain(MISSING);
    });

    it("refuses a diagnose job, saying to name the drive or setup it judges (unhappy)", async () => {
      const { ctrl, diagnoseJob } = await ctrlOver();
      const judging = await diagnoseJob();

      const ran = await ctrl("logs", "--job-id", judging.id);

      expect(ran.code).toBe(1);
      expect(ran.stdout).toBe("");
      expect(ran.stderr).toMatch(/diagnose job/);
      expect(ran.stderr).toMatch(/drive or setup/);
    });

    it("fails with the database's reason when the database is unreachable (unhappy)", async () => {
      const fake = jarl.unwrap(await FakePostgres.start());
      await fake.stop();
      const { ctrl } = await ctrlAt(fake.url, async () => undefined);

      const ran = await ctrl("logs", "--job-id", MISSING);

      expect(ran.code).toBe(1);
      expect(ran.stdout).toBe("");
      expect(ran.stderr).toContain("ECONNREFUSED");
    });
  });

  describe("image", () => {
    it("refuses an image id no image has, naming it, and writes nothing (unhappy)", async () => {
      const { files, ctrl } = await ctrlOver();

      const ran = await ctrl("image", "--image-id", MISSING, "--output", "last.png");

      expect(ran.code).toBe(1);
      expect(ran.stderr).toContain(MISSING);
      expect(files.size).toBe(0);
    });

    it("refuses a write that fails with the file system's reason (unhappy)", async () => {
      const { services, ctrl, failWrites, completedDrive } = await ctrlOver();
      const { job } = await completedDrive();
      const action = jarl.unwrap(
        await services.actions.startAction({ jobId: job.id, request: {} }),
      );
      jarl.unwrap(
        await services.actions.finishAction(
          action,
          { state: "completed", response: {} },
          { id: IMAGE, data: PNG },
        ),
      );
      failWrites(new Error("EACCES: permission denied, open '/root/last.png'"));

      const ran = await ctrl("image", "--image-id", IMAGE, "--output", "/root/last.png");

      expect(ran.code).toBe(1);
      expect(ran.stdout).toBe("");
      expect(ran.stderr).toContain("/root/last.png");
      expect(ran.stderr).toContain("EACCES: permission denied");
    });
  });

  describe("diagnose", () => {
    it("refuses a job that does not exist and stores nothing (unhappy)", async () => {
      const { ctrl, stored } = await ctrlOver();

      const ran = await ctrl("diagnose", "--job-id", MISSING, "--verdict", "passed", ...told);

      expect(ran.code).toBe(1);
      expect(ran.stderr).toContain(MISSING);
      expect(await stored(MISSING)).toEqual({ diagnosis: undefined, errorTypes: [] });
    });

    it("refuses a job that is not a completed drive or setup and stores nothing (unhappy)", async () => {
      const { ctrl, runningDrive, diagnoseJob, stored } = await ctrlOver();
      const { job: running } = await runningDrive();
      const judging = await diagnoseJob();

      const ofRunning = await ctrl(
        "diagnose",
        "--job-id",
        running.id,
        "--verdict",
        "passed",
        ...told,
      );
      const ofJudging = await ctrl(
        "diagnose",
        "--job-id",
        judging.id,
        "--verdict",
        "passed",
        ...told,
      );

      expect(ofRunning.code).toBe(1);
      expect(ofRunning.stderr).toMatch(/running/);
      expect(ofRunning.stderr).toMatch(/completed drive or setup/);
      expect(ofJudging.code).toBe(1);
      expect(ofJudging.stderr).toMatch(/diagnose/);
      expect(ofJudging.stderr).toMatch(/completed drive or setup/);
      expect((await stored(running.id)).diagnosis).toBeUndefined();
      expect((await stored(judging.id)).diagnosis).toBeUndefined();
    });

    it("refuses a passed verdict given a --type and stores nothing (unhappy)", async () => {
      const { ctrl, completedDrive, existingType, stored } = await ctrlOver();
      const { job } = await completedDrive();
      await existingType();

      const ran = await ctrl(
        "diagnose",
        "--job-id",
        job.id,
        "--verdict",
        "passed",
        "--type",
        "lock_screen_missed",
        ...told,
      );

      expect(ran.code).toBe(1);
      expect(ran.stderr).toMatch(/passed/);
      expect(ran.stderr).toMatch(/--type/);
      expect((await stored(job.id)).diagnosis).toBeUndefined();
    });

    it("refuses a failed verdict without a --type and stores nothing (unhappy)", async () => {
      const { ctrl, completedDrive, stored } = await ctrlOver();
      const { job } = await completedDrive();

      const ran = await ctrl("diagnose", "--job-id", job.id, "--verdict", "failed", ...told);

      expect(ran.code).toBe(1);
      expect(ran.stderr).toMatch(/failed/);
      expect(ran.stderr).toMatch(/--type/);
      expect((await stored(job.id)).diagnosis).toBeUndefined();
    });

    it("refuses a --description without a --type and stores nothing (unhappy)", async () => {
      const { ctrl, completedDrive, stored } = await ctrlOver();
      const { job } = await completedDrive();

      const ran = await ctrl(
        "diagnose",
        "--job-id",
        job.id,
        "--verdict",
        "passed",
        "--description",
        "Something new",
        ...told,
      );

      expect(ran.code).toBe(1);
      expect(ran.stderr).toMatch(/--description/);
      expect(ran.stderr).toMatch(/--type/);
      expect(await stored(job.id)).toEqual({ diagnosis: undefined, errorTypes: [] });
    });

    it("refuses a new --type without a --description and stores nothing (unhappy)", async () => {
      const { ctrl, completedDrive, stored } = await ctrlOver();
      const { job } = await completedDrive();

      const ran = await ctrl(
        "diagnose",
        "--job-id",
        job.id,
        ...failed("lock_never_engaged"),
        ...told,
      );

      expect(ran.code).toBe(1);
      expect(ran.stderr).toContain("lock_never_engaged");
      expect(ran.stderr).toMatch(/--description/);
      expect(await stored(job.id)).toEqual({ diagnosis: undefined, errorTypes: [] });
    });

    it("refuses an existing --type given a --description, keeping the type as it is (unhappy)", async () => {
      const { services, ctrl, completedDrive, existingType, stored } = await ctrlOver();
      const { job } = await completedDrive();
      await existingType();

      const ran = await ctrl(
        "diagnose",
        "--job-id",
        job.id,
        ...failed("lock_screen_missed"),
        "--description",
        "Reworded",
        ...told,
      );

      expect(ran.code).toBe(1);
      expect(ran.stderr).toContain("lock_screen_missed");
      expect(ran.stderr).toMatch(/already exists/);
      expect((await stored(job.id)).diagnosis).toBeUndefined();
      expect(
        jarl.unwrap(await services.diagnosis.findErrorType("lock_screen_missed")),
      ).toMatchObject({ description: "The lock never showed" });
    });

    it("refuses a job already diagnosed: the first stands and no type is minted (unhappy)", async () => {
      const { ctrl, completedDrive, stored } = await ctrlOver();
      const { job } = await completedDrive();
      const first = await ctrl("diagnose", "--job-id", job.id, "--verdict", "passed", ...told);

      const again = await ctrl(
        "diagnose",
        "--job-id",
        job.id,
        ...failed("lock_never_engaged"),
        "--description",
        "Super+Ctrl+L sent and the desktop stayed",
        "--summary",
        "Second look",
        "--model",
        MODEL,
      );

      expect(first.code).toBe(0);
      expect(again.code).toBe(1);
      expect(again.stderr).toMatch(/already has a diagnosis/);
      expect(await stored(job.id)).toMatchObject({
        diagnosis: { verdict: "passed", summary: "The lock screen never showed" },
        errorTypes: [],
      });
    });
  });
});
