import * as jarl from "jarl";
import { describe, expect, it } from "vitest";
import * as Logger from "../src/main.ts";
import * as Render from "../src/render.ts";

// A store whose inserts wait until the test lets each one through, keeping every row it was given.
const heldStore = () => {
  const rows: Array<Logger.Row> = [];
  const waiting: Array<() => void> = [];
  const store: Logger.Store = (row) => {
    rows.push(row);
    return new Promise((resolve) => {
      waiting.push(() => resolve(jarl.ok(undefined)));
    });
  };
  const release = () => waiting.shift()?.();
  return { rows, store, release };
};

const track = <T>(promise: Promise<T>) => {
  const state = { settled: false };
  void promise.then(() => {
    state.settled = true;
  });
  return state;
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const logging = (store?: Logger.Store) => {
  const lines: Array<string> = [];
  const write = (line: string) => {
    lines.push(line);
  };
  const logger = Logger.create(
    store === undefined ? { write, colors: false } : { write, colors: false, store },
  );
  return { lines, logger };
};

describe("the logger", () => {
  it("writes one line per call, in call order, when nothing stores them (happy)", () => {
    const { lines, logger } = logging();

    logger.info("one");
    logger.warning("two");
    logger.error("three");
    logger.fatal("four");

    expect(lines).toEqual([
      "[INFO] [global] one",
      "[WARN] [global] two",
      "[ERROR] [global] three",
      "[FATAL] [global] four",
    ]);
  });

  it("carries the agent and location to the line and the row, and nulls when absent (happy)", async () => {
    const rows: Array<Logger.Row> = [];
    const { lines, logger } = logging(async (row) => {
      rows.push(row);
      return jarl.ok(undefined);
    });

    logger.info("booted", { agentId: "OLI-1", location: "s-1" });
    logger.warning("slow");
    await logger.flush();

    expect(rows).toEqual([
      { text: "booted", level: "info", location: "s-1", agentId: "OLI-1" },
      { text: "slow", level: "warning", location: null, agentId: null },
    ]);
    expect(lines).toEqual(["[INFO] [OLI-1] s-1: booted", "[WARN] [global] slow"]);
  });

  it("writes a line only once its row is stored, one row at a time, in call order (happy)", async () => {
    const held = heldStore();
    const { lines, logger } = logging(held.store);

    logger.info("one");
    logger.info("two");
    await settle();
    expect(held.rows.map((row) => row.text)).toEqual(["one"]);
    expect(lines).toEqual([]);

    held.release();
    await settle();
    expect(lines).toEqual(["[INFO] [global] one"]);
    expect(held.rows.map((row) => row.text)).toEqual(["one", "two"]);

    held.release();
    await logger.flush();
    expect(lines).toEqual(["[INFO] [global] one", "[INFO] [global] two"]);
  });

  it("a refused row still writes its line, then says the insert failed, and later lines land (unhappy)", async () => {
    const rows: Array<Logger.Row> = [];
    const { lines, logger } = logging(async (row) => {
      rows.push(row);
      return row.text === "one" ? jarl.err({ message: "connection refused" }) : jarl.ok(undefined);
    });

    logger.info("one");
    logger.info("two");
    await logger.flush();

    expect(lines).toEqual([
      "[INFO] [global] one",
      "[ERROR] [global] db: log insert failed: connection refused",
      "[INFO] [global] two",
    ]);
    expect(rows.map((row) => row.text)).toEqual(["one", "two"]);
  });

  it("a store that throws is a refusal too (unhappy)", async () => {
    const { lines, logger } = logging((row) =>
      row.text === "one"
        ? Promise.reject(new Error("pool ended"))
        : Promise.resolve(jarl.ok(undefined)),
    );

    logger.info("one");
    logger.info("two");
    await logger.flush();

    expect(lines).toEqual([
      "[INFO] [global] one",
      "[ERROR] [global] db: log insert failed: pool ended",
      "[INFO] [global] two",
    ]);
  });

  it("flush settles once every line logged so far has landed, and at once with none (happy)", async () => {
    const held = heldStore();
    const { logger } = logging(held.store);
    await logger.flush();

    logger.info("one");
    const flushed = track(logger.flush());
    await settle();
    expect(flushed.settled).toBe(false);

    held.release();
    await settle();
    expect(flushed.settled).toBe(true);
  });

  it("an agent keeps its colour across lines, and a second agent takes the next (happy)", () => {
    const lines: Array<string> = [];
    const logger = Logger.create({ write: (line) => lines.push(line), colors: true, now: () => 0 });

    logger.info("x", { agentId: "A" });
    logger.info("x", { agentId: "B" });
    logger.info("x", { agentId: "A" });

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
});
