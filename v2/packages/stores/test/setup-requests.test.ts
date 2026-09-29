import * as Db from "@oligarchy/db";
import * as DbSchema from "@oligarchy/db/schema";
import { eq } from "drizzle-orm";
import * as jarl from "jarl";
import { describe, expect, it } from "vitest";
import type * as Tests from "../src/tests.ts";
import { database, MISSING, newJob } from "./support.ts";

const ISO = "omarchy.iso";
const SERVER = "http://qemu-1";
const OTHER = "http://qemu-2";

type Setup = Awaited<ReturnType<typeof database>>;

const setJob = (db: Db.Database, id: string, status: Tests.JobStatus) =>
  db.run((d) => d.update(DbSchema.jobs).set({ status }).where(eq(DbSchema.jobs.id, id)));

// A lock on SERVER in one state: held by no job yet, by a mint in a status, or by a mint
// retention swept.
type Lock = "no job" | "swept" | Tests.JobStatus;

const lockIn = async (setup: Setup, lock: Lock) => {
  expect(jarl.unwrap(await setup.setupRequests.insert(ISO, SERVER))).toBe(true);
  if (lock === "no job") {
    return;
  }
  if (lock === "swept") {
    expect(jarl.unwrap(await setup.setupRequests.setJob(ISO, SERVER, MISSING))).toBe(true);
    return;
  }
  const mint = await newJob(setup.tests, "mint");
  jarl.unwrap(await setJob(setup.db, mint.id, lock));
  expect(jarl.unwrap(await setup.setupRequests.setJob(ISO, SERVER, mint.id))).toBe(true);
};

const LOCKS: ReadonlyArray<Lock> = ["no job", "swept", ...DbSchema.jobStatus.enumValues];

describe("a setup lock, start to finish", () => {
  it("the proxy locks a server, names the mint holding it, and a mint that succeeds keeps it (happy)", async () => {
    const { tests, setupRequests } = await database();
    const mint = await newJob(tests, "mint");

    expect(jarl.unwrap(await setupRequests.insert(ISO, SERVER))).toBe(true);
    expect(jarl.unwrap(await setupRequests.setJob(ISO, SERVER, mint.id))).toBe(true);
    expect(jarl.unwrap(await setupRequests.inspect(ISO, SERVER))).toEqual({
      iso: ISO,
      serverUrl: SERVER,
      jobId: mint.id,
      jobStatus: "pending",
    });
    expect(jarl.unwrap(await setupRequests.serverForJob(mint.id))).toBe(SERVER);

    jarl.unwrap(await tests.runJob(mint.id, "11111111-1111-4111-8111-111111111111"));
    jarl.unwrap(await tests.completeJob(mint.id));
    jarl.unwrap(await tests.finalizeJob(mint.id, "succeeded", null));

    expect(jarl.unwrap(await setupRequests.remove(ISO, SERVER))).toBe(false);
    expect(jarl.unwrap(await setupRequests.inspect(ISO, SERVER))?.jobStatus).toBe("succeeded");
    expect(jarl.unwrap(await setupRequests.list())).toEqual([{ iso: ISO, serverUrl: SERVER }]);
    expect(jarl.unwrap(await setupRequests.removeServer(SERVER))).toBe(1);
    expect(jarl.unwrap(await setupRequests.list())).toEqual([]);
  });
});

describe("a setup lock, state by state", () => {
  it("remove releases a lock with no job or a mint that ended without success, and keeps the rest (unhappy)", async () => {
    const released: Record<string, boolean> = {};
    for (const lock of LOCKS) {
      const setup = await database();
      await lockIn(setup, lock);
      released[lock] = jarl.unwrap(await setup.setupRequests.remove(ISO, SERVER));
      expect(jarl.unwrap(await setup.setupRequests.list()).length).toBe(released[lock] ? 0 : 1);
    }

    expect(released).toEqual({
      "no job": true,
      swept: false,
      pending: false,
      running: false,
      completed: false,
      succeeded: false,
      failed: true,
      errored: true,
      aborted: true,
      timed_out: true,
    });
  });

  it("claim takes a lock from any mint but one pending, running or completed, and never from a lock still waiting on its job (unhappy)", async () => {
    const claimed: Record<string, boolean> = {};
    for (const lock of LOCKS) {
      const setup = await database();
      await lockIn(setup, lock);
      const before = jarl.unwrap(await setup.setupRequests.inspect(ISO, SERVER))?.jobId;
      const claimant = await newJob(setup.tests, "mint");
      claimed[lock] = jarl.unwrap(await setup.setupRequests.claim(ISO, SERVER, claimant.id));
      expect(jarl.unwrap(await setup.setupRequests.inspect(ISO, SERVER))?.jobId).toBe(
        claimed[lock] ? claimant.id : before,
      );
    }

    expect(claimed).toEqual({
      "no job": false,
      swept: true,
      pending: false,
      running: false,
      completed: false,
      succeeded: true,
      failed: true,
      errored: true,
      aborted: true,
      timed_out: true,
    });
  });

  it("claim on a server with no lock takes it at once (happy)", async () => {
    const { tests, setupRequests } = await database();
    const mint = await newJob(tests, "mint");

    expect(jarl.unwrap(await setupRequests.claim(ISO, SERVER, mint.id))).toBe(true);
    expect(jarl.unwrap(await setupRequests.inspect(ISO, SERVER))?.jobId).toBe(mint.id);
  });
});

describe("a setup lock that cannot be taken", () => {
  it("a second insert for the same pair is refused and the first keeps its job (unhappy)", async () => {
    const { tests, setupRequests } = await database();
    const mint = await newJob(tests, "mint");
    jarl.unwrap(await setupRequests.insert(ISO, SERVER));
    jarl.unwrap(await setupRequests.setJob(ISO, SERVER, mint.id));

    expect(jarl.unwrap(await setupRequests.insert(ISO, SERVER))).toBe(false);
    expect(jarl.unwrap(await setupRequests.inspect(ISO, SERVER))?.jobId).toBe(mint.id);
  });

  it("naming the job of a lock that is gone stores nothing (unhappy)", async () => {
    const { tests, setupRequests } = await database();
    const mint = await newJob(tests, "mint");

    expect(jarl.unwrap(await setupRequests.setJob(ISO, SERVER, mint.id))).toBe(false);
    expect(jarl.unwrap(await setupRequests.list())).toEqual([]);
    expect(jarl.unwrap(await setupRequests.serverForJob(mint.id))).toBeUndefined();
    expect(jarl.unwrap(await setupRequests.inspect(ISO, SERVER))).toBeUndefined();
  });

  it("one mint holds one lock at most: a second, by setJob or claim, is a database error and leaves it unheld (unhappy)", async () => {
    const { tests, setupRequests } = await database();
    const mint = await newJob(tests, "mint");
    jarl.unwrap(await setupRequests.claim(ISO, SERVER, mint.id));
    jarl.unwrap(await setupRequests.insert(ISO, OTHER));

    const set = await setupRequests.setJob(ISO, OTHER, mint.id);
    const claimed = await setupRequests.claim("other.iso", SERVER, mint.id);

    expect(jarl.error.is(set, Db.DatabaseError)).toBe(true);
    expect(jarl.error.is(claimed, Db.DatabaseError)).toBe(true);
    expect(jarl.unwrap(await setupRequests.inspect(ISO, OTHER))?.jobId).toBeNull();
    expect(jarl.unwrap(await setupRequests.inspect("other.iso", SERVER))).toBeUndefined();
    expect(jarl.unwrap(await setupRequests.serverForJob(mint.id))).toBe(SERVER);
  });
});
