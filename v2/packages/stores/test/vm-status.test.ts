import * as jarl from "jarl";
import { describe, expect, it } from "vitest";
import { database, newJob } from "./support.ts";

type Setup = Awaited<ReturnType<typeof database>>;

const RESTARTED = "http://qemu-1";
const ELSEWHERE = "http://qemu-2";

const routed = async (setup: Setup, url: string) => {
  const job = await newJob(setup.tests);
  jarl.unwrap(await setup.servers.routeJob(job.id, url));
  return job.id;
};

// The VMs a restarted qemu server finds: two it left live, one it had already ended, one it
// never started, and one live on another server.
const leftBehind = async () => {
  const setup = await database();
  const { vmStatus } = setup;
  const running = await routed(setup, RESTARTED);
  jarl.unwrap(await vmStatus.record(running, "running"));
  const downloading = await routed(setup, RESTARTED);
  jarl.unwrap(await vmStatus.record(downloading, "downloading"));
  const ended = await routed(setup, RESTARTED);
  jarl.unwrap(await vmStatus.record(ended, "running"));
  jarl.unwrap(await vmStatus.stop(ended, { status: "shutdown" }));
  const unstarted = await routed(setup, RESTARTED);
  const elsewhere = await routed(setup, ELSEWHERE);
  jarl.unwrap(await vmStatus.record(elsewhere, "running"));
  return { vmStatus, running, downloading, ended, unstarted, elsewhere };
};

const statusOf = async (vmStatus: Setup["vmStatus"], jobId: string) =>
  jarl.unwrap(await vmStatus.current(jobId))?.status;

describe("a job's VM", () => {
  it("its status is its newest change, and its history keeps every change, oldest first (happy)", async () => {
    const { tests, vmStatus } = await database();
    const job = await newJob(tests);

    jarl.unwrap(await vmStatus.record(job.id, "downloading"));
    jarl.unwrap(await vmStatus.record(job.id, "running"));
    jarl.unwrap(
      await vmStatus.stop(job.id, { status: "crashed", reason: "qemu exited on SIGSEGV" }),
    );

    expect(jarl.unwrap(await vmStatus.current(job.id))).toMatchObject({
      status: "crashed",
      reason: "qemu exited on SIGSEGV",
    });
    expect(jarl.unwrap(await vmStatus.history(job.id)).map((row) => row.status)).toEqual([
      "downloading",
      "running",
      "crashed",
    ]);
  });
});

describe("a restarted qemu server's lost VMs", () => {
  it("each VM it left downloading or running ends crashed, as the server restarted, and its job is named (happy)", async () => {
    const { vmStatus, running, downloading } = await leftBehind();

    const lost = jarl.unwrap(await vmStatus.stopLost(RESTARTED));

    expect([...lost].sort()).toEqual([running, downloading].sort());
    for (const jobId of [running, downloading]) {
      expect(jarl.unwrap(await vmStatus.current(jobId))).toMatchObject({
        status: "crashed",
        reason: "qemu server restarted",
      });
    }
  });

  it("a VM it had already ended, one it never started, and one on another server are left as they were (unhappy)", async () => {
    const { vmStatus, ended, unstarted, elsewhere } = await leftBehind();

    jarl.unwrap(await vmStatus.stopLost(RESTARTED));

    expect(await statusOf(vmStatus, ended)).toBe("shutdown");
    expect(await statusOf(vmStatus, unstarted)).toBeUndefined();
    expect(await statusOf(vmStatus, elsewhere)).toBe("running");
  });
});
