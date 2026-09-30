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

describe("the logger's database", () => {
  it("a connection the database drops is one error line, printed though it cannot be stored, and later lines print (unhappy)", async () => {
    const { fake, lines, logger } = await logging();
    logger.info("before");
    await logger.flush();

    await fake?.stop();
    await vi.waitFor(() => {
      expect(lines.some((line) => line.startsWith("[ERROR] [global] db: pool error: "))).toBe(true);
    });
    logger.info("after");
    await logger.flush();

    const pooled = lines.filter((line) => line.startsWith("[ERROR] [global] db: pool error: "));
    expect(pooled).toHaveLength(1);
    const afterAt = lines.indexOf("[INFO] [global] after");
    expect(afterAt).toBeGreaterThan(lines.indexOf(pooled[0] ?? ""));
    expect(lines[afterAt + 1]).toMatch(/^\[ERROR\] \[global\] db: log insert failed: /);
  });
});
