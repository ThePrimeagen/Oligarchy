import * as Db from "@oligarchy/db";
import { describe, expect, it, vi } from "vitest";
import * as Render from "../src/render.ts";
import { logging, track, UNREACHABLE } from "./support.ts";

describe("the logger", () => {
  it("prints each line once its row is stored, rows in call order with level and location, and flush settles after the last (happy)", async () => {
    const { lines, logger, rows } = await logging();
    await logger.flush();

    logger.info("booted", { agentId: "OLI-1", location: "s-1" });
    logger.warning("slow");
    logger.error("qemu exited", { location: "s-1" });
    logger.fatal("config unreadable");
    const flushed = track(logger.flush());

    expect(lines).toEqual([]);
    expect(flushed.settled).toBe(false);
    await logger.flush();
    expect(flushed.settled).toBe(true);
    expect(lines).toEqual([
      "[INFO] [OLI-1] s-1: booted",
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

  it("an agent keeps its colour across lines, and a second agent takes the next (happy)", async () => {
    const { lines, logger } = await logging({ colors: true, now: () => 0 });

    logger.info("x", { agentId: "A" });
    logger.info("x", { agentId: "B" });
    logger.info("x", { agentId: "A" });
    await logger.flush();

    const painted = (agentId: string, color: string | undefined) =>
      Render.renderLine(
        { text: "x", level: "info", agentId, ...(color === undefined ? {} : { color }) },
        true,
      );
    expect(lines).toEqual([
      painted("A", Render.AGENT_COLORS[0]),
      painted("B", Render.AGENT_COLORS[1]),
      painted("A", Render.AGENT_COLORS[0]),
    ]);
  });

  it("with the database unreachable, a line still prints, then says its insert failed, and later lines print too (unhappy)", async () => {
    const { lines, logger } = await logging({ url: UNREACHABLE });

    logger.info("one");
    logger.info("two");
    await logger.flush();

    expect(lines).toHaveLength(4);
    expect(lines[0]).toBe("[INFO] [global] one");
    expect(lines[1]).toMatch(/^\[ERROR\] \[global\] db: log insert failed: [\s\S]*ECONNREFUSED/);
    expect(lines[2]).toBe("[INFO] [global] two");
    expect(lines[3]).toMatch(/^\[ERROR\] \[global\] db: log insert failed: /);
  });
});

describe("the logger's Sentry", () => {
  it("sends an error line's cause, and a fatal line without one as its text, each once with its level, tags and text (happy)", async () => {
    const { lines, sent, logger } = await logging();
    const cause = new Error("connect ECONNREFUSED");

    logger.error("stop cleanup failed: connect ECONNREFUSED", {
      location: "s-1",
      agentId: "OLI-1",
      cause,
    });
    logger.fatal("config unreadable");
    await logger.flush();

    expect(lines).toEqual([
      "[ERROR] [OLI-1] s-1: stop cleanup failed: connect ECONNREFUSED",
      "[FATAL] [global] config unreadable",
    ]);
    expect(sent).toEqual([
      {
        error: cause,
        jobId: undefined,
        report: {
          level: "error",
          tags: { location: "s-1", agent_id: "OLI-1" },
          extra: {
            log: "stop cleanup failed: connect ECONNREFUSED",
            location: "s-1",
            agent_id: "OLI-1",
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

  it("with the database unreachable, sends the line and then the insert's DatabaseError as the line saying so (unhappy)", async () => {
    const { lines, sent, logger } = await logging({ url: UNREACHABLE });

    logger.error("qemu exited");
    logger.info("booted");
    await logger.flush();

    const said = [lines[1], lines[3]].map((line) => line?.replace("[ERROR] [global] ", ""));
    expect(sent.map(({ report }) => report)).toEqual([
      { level: "error", tags: {}, extra: { log: "qemu exited" } },
      { level: "error", tags: {}, extra: { log: said[0] } },
      { level: "error", tags: {}, extra: { log: said[1] } },
    ]);
    expect(sent[0]?.error).toEqual(new Error("qemu exited"));
    expect(sent[1]?.error).toBeInstanceOf(Db.DatabaseError);
    expect(sent[2]?.error).toBeInstanceOf(Db.DatabaseError);
    expect(said[0]).toBe(`db: log insert failed: ${(sent[1]?.error as Error).message}`);
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

    const pooled = lines.filter((line) => line.includes("db: pool error: "));
    expect(pooled).toHaveLength(1);
    const text = pooled[0]?.replace("[ERROR] [global] ", "");
    const reported = sent.find(({ report }) => report.extra?.["log"] === text);
    expect(reported?.report).toEqual({ level: "error", tags: {}, extra: { log: text } });
    expect(reported?.error).toBeInstanceOf(Error);
    expect(reported?.error).not.toBeInstanceOf(Db.DatabaseError);
    expect(text).toBe(`db: pool error: ${(reported?.error as Error).message}`);
  });
});
