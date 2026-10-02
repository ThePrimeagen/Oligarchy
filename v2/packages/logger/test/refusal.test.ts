import * as App from "@oligarchy/app";
import * as Db from "@oligarchy/db";
import * as SentryTesting from "@oligarchy/sentry/testing";
import * as jarl from "jarl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Logger from "../src/main.ts";

const logging = (error: Db.DatabaseError) => {
  const db = App.createService<never, App.NoOptions, Db.Database>(() => ({
    service: "db",
    run: async () => jarl.err(error),
    close: async () => jarl.ok(undefined),
    onPoolError: () => () => undefined,
  }))({});
  const reporter = SentryTesting.sentry();
  const lines: Array<string> = [];
  const logger = Logger.create(
    { db, sentry: reporter.sentry },
    { write: (line) => lines.push(line), colors: false },
  );
  return { logger, lines, sent: reporter.sent };
};

describe("the logger when database writes fail", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("prints each line followed by its insert failure, and continues with later lines (unhappy)", async () => {
    const { lines, logger } = logging(new Db.DatabaseError("connection refused"));

    logger.info("one");
    logger.info("two");
    await logger.flush();

    expect(lines).toEqual([
      "[INFO] [global] one",
      "[ERROR] [global] db: log insert failed: connection refused",
      "[INFO] [global] two",
      "[ERROR] [global] db: log insert failed: connection refused",
    ]);
  });

  it("reports the error line and each insert's DatabaseError to Sentry (unhappy)", async () => {
    const error = new Db.DatabaseError("connection refused");
    const { sent, logger } = logging(error);

    logger.error("qemu exited");
    logger.info("booted");
    await logger.flush();

    expect(sent.map(({ report }) => report)).toEqual([
      { level: "error", tags: {}, extra: { log: "qemu exited" } },
      {
        level: "error",
        tags: {},
        extra: { log: "db: log insert failed: connection refused" },
      },
      {
        level: "error",
        tags: {},
        extra: { log: "db: log insert failed: connection refused" },
      },
    ]);
    expect(sent[0]?.error).toEqual(new Error("qemu exited"));
    expect(sent[1]?.error).toBe(error);
    expect(sent[2]?.error).toBe(error);
  });
});
