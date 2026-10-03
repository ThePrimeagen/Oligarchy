import * as Db from "@oligarchy/db";
import { describe, expect, it, vi } from "vitest";
import * as Render from "../src/render.ts";
import { logging, track } from "./support.ts";

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

describe("the logger", () => {
  it("prints each line once its row is stored, rows in call order with level and location, and flush settles after the last (happy)", async () => {
    const { lines, logger, rows } = await logging();
    await logger.flush();

    logger.info("booted", { jobId: "11111111-1111-4111-8111-111111111111", location: "s-1" });
    logger.warning("slow");
    logger.error("qemu exited", { location: "s-1" });
    logger.fatal("config unreadable");
    const flushed = track(logger.flush());

    expect(lines).toEqual([]);
    expect(flushed.settled).toBe(false);
    await logger.flush();
    expect(flushed.settled).toBe(true);
    expect(lines).toEqual([
      "[INFO] [11111111-1111-4111-8111-111111111111] s-1: booted",
      "[WARN] [global] slow",
      "[ERROR] [global] s-1: qemu exited",
      "[FATAL] [global] config unreadable",
    ]);
    expect(await rows()).toEqual([
      ["info", "s-1", "booted"],
      ["warning", null, "slow"],
      ["error", "s-1", "qemu exited"],
      ["fatal", null, "config unreadable"],
    ]);
  });

  it("a job keeps its colour across lines, and a second job takes the next (happy)", async () => {
    const { lines, logger } = await logging({ colors: true, now: () => 0 });

    logger.info("x", { jobId: "11111111-1111-4111-8111-111111111111" });
    logger.info("x", { jobId: "22222222-2222-4222-8222-222222222222" });
    logger.info("x", { jobId: "11111111-1111-4111-8111-111111111111" });
    await logger.flush();

    const painted = (jobId: string, color: string | undefined) =>
      Render.renderLine(
        { text: "x", level: "info", jobId, ...(color === undefined ? {} : { color }) },
        true,
      );
    expect(lines).toEqual([
      painted("11111111-1111-4111-8111-111111111111", Render.JOB_COLORS[0]),
      painted("22222222-2222-4222-8222-222222222222", Render.JOB_COLORS[1]),
      painted("11111111-1111-4111-8111-111111111111", Render.JOB_COLORS[0]),
    ]);
  });
});

describe("the logger's Sentry", () => {
  it("sends an error line's cause, and a fatal line without one as its text, each once with its level, tags and text (happy)", async () => {
    const { lines, sent, logger } = await logging();
    const cause = new Error("connect ECONNREFUSED");

    logger.error("stop cleanup failed: connect ECONNREFUSED", {
      location: "s-1",
      jobId: "11111111-1111-4111-8111-111111111111",
      cause,
    });
    logger.fatal("config unreadable");
    await logger.flush();

    expect(lines).toEqual([
      "[ERROR] [11111111-1111-4111-8111-111111111111] s-1: stop cleanup failed: connect ECONNREFUSED",
      "[FATAL] [global] config unreadable",
    ]);
    expect(sent).toEqual([
      {
        error: cause,
        jobId: "11111111-1111-4111-8111-111111111111",
        report: {
          level: "error",
          tags: { location: "s-1", job_id: "11111111-1111-4111-8111-111111111111" },
          extra: {
            log: "stop cleanup failed: connect ECONNREFUSED",
            location: "s-1",
            job_id: "11111111-1111-4111-8111-111111111111",
          },
        },
      },
      {
        error: new Error("config unreadable"),
        jobId: undefined,
        report: { level: "fatal", tags: {}, extra: { log: "config unreadable" } },
      },
    ]);
  });

  it("never sends an info or a warning line (unhappy)", async () => {
    const { lines, sent, logger, rows } = await logging();

    logger.info("booted");
    logger.warning("slow");
    await logger.flush();

    expect(lines).toEqual(["[INFO] [global] booted", "[WARN] [global] slow"]);
    expect(await rows()).toHaveLength(2);
    expect(sent).toEqual([]);
  });

  it("prints and stores an error or fatal line marked skipSentry, and sends neither (unhappy)", async () => {
    const { lines, rows, sent, logger } = await logging();

    logger.error("POST /stop failed: unauthorized", { skipSentry: true });
    logger.fatal("shutting down", { skipSentry: true, cause: new Error("SIGTERM") });
    await logger.flush();

    expect(lines).toEqual([
      "[ERROR] [global] POST /stop failed: unauthorized",
      "[FATAL] [global] shutting down",
    ]);
    expect(await rows()).toEqual([
      ["error", null, "POST /stop failed: unauthorized"],
      ["fatal", null, "shutting down"],
    ]);
    expect(sent).toEqual([]);
  });

  it("a connection the database drops is one error line, sent with the pool's error as its cause (unhappy)", async () => {
    const { fake, lines, sent, logger } = await logging();
    logger.info("before");
    await logger.flush();

    await fake?.stop();
    await vi.waitFor(() => {
      expect(lines.some((line) => line.startsWith("[ERROR] [global] db: pool error: "))).toBe(true);
    });
    await logger.flush();

    const pooled = lines.filter((line) => line.startsWith("[ERROR] [global] db: pool error: "));
    expect(pooled).toHaveLength(1);
    const text = pooled[0]?.replace("[ERROR] [global] ", "");
    const reported = sent.find(({ report }) => report.extra?.["log"] === text);
    expect(reported?.report).toEqual({ level: "error", tags: {}, extra: { log: text } });
    expect(reported?.error).toBeInstanceOf(Error);
    expect(reported?.error).not.toBeInstanceOf(Db.DatabaseError);
    expect(text).toBe(`db: pool error: ${messageOf(reported?.error)}`);
  });
});
