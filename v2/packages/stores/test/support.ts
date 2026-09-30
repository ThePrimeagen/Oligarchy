import { readFileSync } from "node:fs";
import * as Db from "@oligarchy/db";
import * as Env from "@oligarchy/env";
import * as FakePostgres from "@oligarchy/fake-postgres";
import * as jarl from "jarl";
import { afterEach } from "vitest";
import * as Actions from "../src/actions.ts";
import * as DebugLogs from "../src/debug-logs.ts";
import * as Diagnosis from "../src/diagnosis.ts";
import * as Logs from "../src/logs.ts";
import * as Servers from "../src/servers.ts";
import * as SetupRequests from "../src/setup-requests.ts";
import * as Tests from "../src/tests.ts";
import * as VmStatus from "../src/vm-status.ts";

const cleanups: Array<() => Promise<unknown>> = [];

afterEach(async () => {
  for (let cleanup = cleanups.pop(); cleanup !== undefined; cleanup = cleanups.pop()) {
    await cleanup();
  }
});

const CONFIG = readFileSync(Env.CONFIG_PATH, "utf8");

const opened = async (url: string) => {
  const env = jarl.unwrap(
    await Env.create(
      Env.cli({ name: "stores-test", description: "" }).needs("databaseUrl").done(),
      Env.fakeIo({ env: { DATABASE_URL: url }, files: { [Env.CONFIG_PATH]: CONFIG } }),
    ),
  );
  const db = Db.create({}, { url: env.vars.databaseUrl });
  cleanups.push(() => db.close());
  return db;
};

// A migrated database of the test's own, with every store over it.
export const database = async () => {
  const fake = jarl.unwrap(await FakePostgres.start());
  cleanups.push(() => fake.stop());
  const db = await opened(fake.url);
  return {
    db,
    tests: Tests.create({ db }),
    actions: Actions.create({ db }),
    debugLogs: DebugLogs.create({ db }),
    diagnosis: Diagnosis.create({ db }),
    logs: Logs.create({ db }),
    servers: Servers.create({ db }),
    setupRequests: SetupRequests.create({ db }),
    vmStatus: VmStatus.create({ db }),
  };
};

// A job on a test run of its own: the drive it was filed with, or a job of another action after
// that drive was aborted.
export const newJob = async (tests: Tests.Tests, action: Tests.JobAction = "drive") => {
  const definition = jarl.unwrap(
    await tests.defineTestDefinition({
      name: "lock-screen",
      description: "",
      instruction: "",
      proof: "",
      resume: true,
    }),
  );
  const { run, job } = jarl.unwrap(
    await tests.createTestRun({
      definitionId: definition.id,
      iso: "omarchy.iso",
      serverUrl: "http://qemu-1",
    }),
  );
  if (action === "drive") {
    return job;
  }
  jarl.unwrap(await tests.abortJob(job.id, "making way"));
  return jarl.unwrap(await tests.createJob(run.id, action));
};

export const MISSING = "00000000-0000-4000-8000-000000000000";
