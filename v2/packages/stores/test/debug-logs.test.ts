import * as Db from "@oligarchy/db";
import * as DbSchema from "@oligarchy/db/schema";
import { eq } from "drizzle-orm";
import * as jarl from "jarl";
import { describe, expect, it } from "vitest";
import * as Tests from "../src/tests.ts";
import { database, MISSING, newJob } from "./support.ts";

const SERVER = "11111111-1111-4111-8111-111111111111";

// Seconds past one fixed instant: which turn a line falls in is set here, not left to the clock.
const at = (seconds: number) => new Date(Date.UTC(2026, 8, 29, 12, 0, seconds));

const stamp = (seconds: number) => at(seconds).toISOString();

describe("a job's debug log", () => {
  it("each job of a test run keeps the guest's output, its own actions, and the log lines of its turn (happy)", async () => {
    const { db, tests, actions, debugLogs } = await database();
    const first = await newJob(tests);
    jarl.unwrap(await tests.abortJob(first.id, "the guest never booted"));
    const second = jarl.unwrap(await tests.createJob(first.runId, "drive"));
    jarl.unwrap(await tests.runJob(second.id, SERVER));
    jarl.unwrap(await tests.errorJob(second.id, "qemu exited"));
    const third = jarl.unwrap(await tests.createJob(first.runId, "drive"));
    const elsewhere = await newJob(tests);
    const queued = async (jobId: string, seconds: number) =>
      jarl.unwrap(
        await db.run((d) =>
          d
            .update(DbSchema.jobs)
            .set({ createdAt: at(seconds) })
            .where(eq(DbSchema.jobs.id, jobId)),
        ),
      );
    await queued(first.id, 0);
    await queued(second.id, 10);
    await queued(third.id, 20);
    await queued(elsewhere.id, 10);
    const line = async (
      seconds: number,
      runId: string | null,
      text: string,
      options: { readonly level?: "info" | "error"; readonly location?: string } = {},
    ) =>
      jarl.unwrap(
        await db.run((d) =>
          d.insert(DbSchema.logs).values({
            text,
            runId,
            level: options.level ?? "info",
            location: options.location ?? "qemu-server",
            createdAt: at(seconds),
          }),
        ),
      );
    await line(5, first.runId, "downloading omarchy.iso");
    await line(10, first.runId, "reserved on qemu-1", { location: "qemu-reverse-proxy" });
    await line(12, first.runId, "GET /image failed: qemu: closed", { level: "error" });
    await line(12, elsewhere.runId, "another run's line");
    await line(13, null, "a line about no run");
    await line(20, first.runId, "reserved on qemu-2", { location: "qemu-reverse-proxy" });
    await line(25, first.runId, "running; started in 12ms");
    const shot = jarl.unwrap(
      await actions.startAction({ jobId: second.id, request: { execute: "screendump" } }),
    );
    jarl.unwrap(await actions.finishAction(shot, { state: "completed", response: { ok: true } }));
    const keys = jarl.unwrap(
      await actions.startAction({ jobId: second.id, request: { execute: "send-key" } }),
    );
    jarl.unwrap(await actions.startAction({ jobId: elsewhere.id, request: { execute: "quit" } }));

    for (const job of [first, second, third]) {
      const captured =
        job === second
          ? { serial: "journalctl\nfailed unit", qemu: "kvm: not available\n" }
          : { serial: "", qemu: "" };
      jarl.unwrap(await debugLogs.saveDebugLog(job.id, captured));
    }

    const taken = new Map(
      jarl.unwrap(await actions.listActions(second.id)).map((row) => [row.id, row.createdAt]),
    );
    const madeAt = (id: number) => taken.get(id)?.toISOString();
    const saved = jarl.unwrap(await debugLogs.getDebugLog(second.id));
    expect(saved?.jobId).toBe(second.id);
    expect(saved?.sources).toEqual({
      serial: "journalctl\nfailed unit",
      qemu: "kvm: not available\n",
      proxy: [
        `${stamp(10)} info qemu-reverse-proxy reserved on qemu-1`,
        `${stamp(12)} error qemu-server GET /image failed: qemu: closed`,
      ].join("\n"),
      actions: [
        `${madeAt(shot)} ${String(shot)} completed {"execute":"screendump"} {"ok":true}`,
        `${madeAt(keys)} ${String(keys)} open {"execute":"send-key"}`,
      ].join("\n"),
    });
    expect(jarl.unwrap(await debugLogs.getDebugLog(first.id))?.sources).toMatchObject({
      proxy: `${stamp(5)} info qemu-server downloading omarchy.iso`,
      actions: "",
    });
    expect(jarl.unwrap(await debugLogs.getDebugLog(third.id))?.sources.proxy).toBe(
      [
        `${stamp(20)} info qemu-reverse-proxy reserved on qemu-2`,
        `${stamp(25)} info qemu-server running; started in 12ms`,
      ].join("\n"),
    );
  });

  it("a debug log for a job that does not exist is refused with NotFound, and nothing is stored (unhappy)", async () => {
    const { debugLogs } = await database();

    const saved = await debugLogs.saveDebugLog(MISSING, { serial: "orphan", qemu: "" });

    if (!jarl.error.is(saved, Tests.NotFound)) {
      throw new Error("expected NotFound");
    }
    expect(saved.error.message).toBe(`saveDebugLog: no job ${MISSING}`);
    expect(jarl.unwrap(await debugLogs.getDebugLog(MISSING))).toBeUndefined();
  });

  it("a second debug log for a job is a database error, and the first stands (unhappy)", async () => {
    const { tests, debugLogs } = await database();
    const drive = await newJob(tests);
    jarl.unwrap(await debugLogs.saveDebugLog(drive.id, { serial: "first", qemu: "" }));

    const again = await debugLogs.saveDebugLog(drive.id, { serial: "second", qemu: "" });

    expect(jarl.error.is(again, Db.DatabaseError)).toBe(true);
    expect(jarl.unwrap(await debugLogs.getDebugLog(drive.id))?.sources.serial).toBe("first");
  });

  it("a job that never saved one has no debug log (unhappy)", async () => {
    const { tests, debugLogs } = await database();
    const drive = await newJob(tests);

    expect(jarl.unwrap(await debugLogs.getDebugLog(drive.id))).toBeUndefined();
  });

  it("a source over a megabyte keeps its last megabyte, marked truncated (unhappy)", async () => {
    const { tests, debugLogs } = await database();
    const drive = await newJob(tests);
    const serial = `head-noise\n${"z".repeat(1_048_576)}crash-tail`;

    jarl.unwrap(await debugLogs.saveDebugLog(drive.id, { serial, qemu: "kvm: not available\n" }));

    const sources = jarl.unwrap(await debugLogs.getDebugLog(drive.id))?.sources;
    expect(sources?.serial.length).toBe(1_048_576);
    expect(sources?.serial.startsWith("[truncated]\n")).toBe(true);
    expect(sources?.serial.endsWith("zzcrash-tail")).toBe(true);
    expect(sources?.serial.includes("head-noise")).toBe(false);
    expect(sources?.qemu).toBe("kvm: not available\n");
    expect(sources?.proxy).toBe("");
    expect(sources?.actions).toBe("");
  });
});
