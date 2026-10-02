import type * as Db from "@oligarchy/db";
import * as DbSchema from "@oligarchy/db/schema";
import { eq } from "drizzle-orm";
import * as jarl from "jarl";
import { describe, expect, it } from "vitest";
import * as Logs from "../src/logs.ts";
import * as Tests from "../src/tests.ts";
import { database, MISSING, newJob } from "./support.ts";

const at = (seconds: number) => new Date(Date.UTC(2026, 8, 29, 12, 0, seconds));

type Setup = Awaited<ReturnType<typeof database>>;

// Writes a job's guest history at fixed instants, so which frame a row falls in is set here, not
// left to the clock.
const history = ({ db }: Setup, job: { readonly id: string; readonly runId: string }) => {
  const write = async <T>(query: (d: Db.Drizzle) => Promise<T>): Promise<T> =>
    jarl.unwrap(await db.run(query));
  return {
    queued: (jobId: string, seconds: number) =>
      write((d) =>
        d
          .update(DbSchema.jobs)
          .set({ createdAt: at(seconds) })
          .where(eq(DbSchema.jobs.id, jobId)),
      ),
    line: (seconds: number, text: string, runId: string = job.runId) =>
      write((d) =>
        d
          .insert(DbSchema.logs)
          .values({ text, runId, location: "qemu-server", createdAt: at(seconds) }),
      ),
    action: async (seconds: number, execute: string) => {
      const [row] = await write((d) =>
        d
          .insert(DbSchema.actions)
          .values({ jobId: job.id, request: { execute }, createdAt: at(seconds) })
          .returning({ id: DbSchema.actions.id }),
      );
      if (row === undefined) {
        throw new Error("no action row");
      }
      return row.id;
    },
    screenshot: async (seconds: number, id: string, data: ReadonlyArray<number>) => {
      const [row] = await write((d) =>
        d
          .insert(DbSchema.actions)
          .values({ jobId: job.id, request: { execute: "screendump" }, createdAt: at(seconds) })
          .returning({ id: DbSchema.actions.id }),
      );
      if (row === undefined) {
        throw new Error("no action row");
      }
      await write((d) =>
        d.insert(DbSchema.images).values({ id, actionId: row.id, data: Buffer.from(data) }),
      );
    },
    move: (seconds: number, step: number, name: string) =>
      write((d) =>
        d.insert(DbSchema.moves).values({
          jobId: job.id,
          kind: "move",
          step,
          name,
          reason: `step ${String(step)}`,
          arguments: {},
          outcome: "done",
          createdAt: at(seconds),
        }),
      ),
    vm: (seconds: number, status: "running" | "stopped") =>
      write((d) =>
        d.insert(DbSchema.vmStatus).values({ jobId: job.id, status, createdAt: at(seconds) }),
      ),
  };
};

const FIRST = "33333333-3333-4333-8333-333333333333";
const SECOND = "44444444-4444-4444-8444-444444444444";

// One drive: booted, an intent, a screenshot, keys, a screenshot, the next intent, a click, and
// the stop. A later job on the same run, and another run, write lines no frame of it holds.
const driven = async () => {
  const setup = await database();
  const job = await newJob(setup.tests);
  const write = history(setup, job);
  await write.queued(job.id, 0);
  await write.vm(1, "running");
  await write.line(2, "downloading omarchy.iso");
  await write.line(3, "intent start; Type the password");
  await write.screenshot(10, FIRST, [1]);
  await write.action(11, "send-key");
  await write.move(12, 1, "send_keys");
  await write.line(13, "typed");
  await write.screenshot(20, SECOND, [2]);
  await write.line(21, "intent end");
  await write.line(22, "intent start; Look at the desktop");
  await write.action(23, "input-send-event");
  await write.action(24, "input-send-event");
  await write.move(25, 2, "mouse_click");
  await write.vm(26, "stopped");
  const other = await newJob(setup.tests);
  await write.line(22, "another run's line", other.runId);
  jarl.unwrap(await setup.tests.abortJob(job.id, "making way"));
  const next = jarl.unwrap(await setup.tests.createJob(job.runId, "diagnose"));
  await write.queued(next.id, 40);
  await write.line(41, "the next job's line");
  return { ...setup, job };
};

// What a frame holds, read for comparing.
const summary = (frame: Logs.Frame) => ({
  frame: frame.frame,
  frames: frame.frames,
  screenshot: frame.screenshot === null ? null : [frame.screenshot.id, [...frame.screenshot.data]],
  openIntent: frame.openIntent,
  actions: frame.actions.map((row) => row.request),
  moves: frame.moves.map((row) => row.name),
  logs: frame.logs.map((row) => row.text),
  vmStatus: frame.vmStatus.map((row) => row.status),
});

describe("a job's frames", () => {
  it("walk back one screenshot each: the newest frame first, each with what happened from its screenshot until the next, and last the frame before the first screenshot (happy)", async () => {
    const { logs, job } = await driven();

    const frames = [0, 1, 2].map(async (frame) =>
      summary(jarl.unwrap(await logs.getFrame(job.id, frame))),
    );

    expect(await Promise.all(frames)).toEqual([
      {
        frame: 0,
        frames: 3,
        screenshot: [SECOND, [2]],
        openIntent: "Type the password",
        actions: [
          { execute: "screendump" },
          { execute: "input-send-event" },
          { execute: "input-send-event" },
        ],
        moves: ["mouse_click"],
        logs: ["intent end", "intent start; Look at the desktop"],
        vmStatus: ["stopped"],
      },
      {
        frame: 1,
        frames: 3,
        screenshot: [FIRST, [1]],
        openIntent: "Type the password",
        actions: [{ execute: "screendump" }, { execute: "send-key" }],
        moves: ["send_keys"],
        logs: ["typed"],
        vmStatus: [],
      },
      {
        frame: 2,
        frames: 3,
        screenshot: null,
        openIntent: null,
        actions: [],
        moves: [],
        logs: ["downloading omarchy.iso", "intent start; Type the password"],
        vmStatus: ["running"],
      },
    ]);
  });

  it("past the oldest, or before the newest, is no frame, naming how many there are (unhappy)", async () => {
    const { logs, job } = await driven();

    for (const frame of [3, -1]) {
      const got = await logs.getFrame(job.id, frame);

      if (!jarl.error.is(got, Logs.NoFrame)) {
        throw new Error("expected NoFrame");
      }
      expect(got.error.message).toBe(
        `getFrame: job ${job.id} has 3 frames; no frame ${String(frame)}`,
      );
    }
  });

  it("of a job with no screenshots is one frame holding everything (unhappy)", async () => {
    const setup = await database();
    const job = await newJob(setup.tests);
    const write = history(setup, job);
    await write.queued(job.id, 0);
    await write.vm(1, "running");
    await write.line(2, "intent start; Type the password");
    await write.action(3, "send-key");
    await write.move(4, 1, "send_keys");

    expect(summary(jarl.unwrap(await setup.logs.getFrame(job.id, 0)))).toEqual({
      frame: 0,
      frames: 1,
      screenshot: null,
      openIntent: null,
      actions: [{ execute: "send-key" }],
      moves: ["send_keys"],
      logs: ["intent start; Type the password"],
      vmStatus: ["running"],
    });
  });

  it("of a job that does not exist are refused with NotFound (unhappy)", async () => {
    const { logs } = await database();

    const got = await logs.getFrame(MISSING, 0);

    if (!jarl.error.is(got, Tests.NotFound)) {
      throw new Error("expected NotFound");
    }
    expect(got.error.message).toBe(`getFrame: no job ${MISSING}`);
  });
});

describe("the logs", () => {
  it("a test run's intents are its own intent lines, in order (happy)", async () => {
    const { tests, logs } = await database();
    const { runId } = await newJob(tests);
    const { runId: other } = await newJob(tests);
    const line = (text: string, run: string | null) =>
      logs.insertLog({ text, level: "info", location: "automation-client", runId: run });
    jarl.unwrap(await line("intent start; open the lock screen", runId));
    jarl.unwrap(await line("clicked", runId));
    jarl.unwrap(await line("intent start; someone else's", other));
    jarl.unwrap(await line("intent end", runId));
    jarl.unwrap(await line("intent end", null));

    expect(jarl.unwrap(await logs.listIntents(runId)).map((intent) => intent.text)).toEqual([
      "intent start; open the lock screen",
      "intent end",
    ]);
    expect(
      jarl.unwrap(await logs.listLogs("automation-client")).map((row) => [row.runId, row.text]),
    ).toEqual([
      [runId, "intent start; open the lock screen"],
      [runId, "clicked"],
      [other, "intent start; someone else's"],
      [runId, "intent end"],
      [null, "intent end"],
    ]);
  });

  it("a line naming a test run that does not exist is still stored (unhappy)", async () => {
    const { logs } = await database();

    jarl.unwrap(
      await logs.insertLog({ text: "late", level: "error", location: "tester", runId: MISSING }),
    );

    expect(
      jarl
        .unwrap(await logs.listRecent(10))
        .map((row) => [row.level, row.location, row.runId, row.text]),
    ).toEqual([["error", "tester", MISSING, "late"]]);
    expect(jarl.unwrap(await logs.listIntents(MISSING))).toEqual([]);
  });
});
