import * as Db from "@oligarchy/db";
import * as Logger from "@oligarchy/logger";
import * as SentryTesting from "@oligarchy/sentry/testing";
import * as jarl from "jarl";
import { describe, expect, it } from "vitest";
import { report } from "../src/report.ts";

const logging = () => {
  const lines: Array<string> = [];
  const fake = SentryTesting.sentry();
  const logger = Logger.create({
    write: (line) => lines.push(line),
    colors: false,
    sentry: fake.sentry,
  });
  return { lines, logger, sent: fake.sent };
};

describe("the tester's report", () => {
  it("says the running suites and the passing and failing tests as info when nothing fails (happy)", () => {
    const { lines, logger } = logging();

    const reported = report(logger, jarl.ok({ running: 2, passing: 5, failing: 0 }));

    expect(reported.ok).toBe(true);
    expect(lines).toEqual([
      "[INFO] [global] tester: running test suites: 2",
      "[INFO] [global] tester: passing tests: 5",
      "[INFO] [global] tester: failing tests: 0",
    ]);
  });

  it("failing tests are a warning (unhappy)", () => {
    const { lines, logger } = logging();

    report(logger, jarl.ok({ running: 0, passing: 5, failing: 3 }));

    expect(lines.at(-1)).toBe("[WARN] [global] tester: failing tests: 3");
  });

  it("a database that cannot count is an error line sent to Sentry as the database's error, and the error comes back (unhappy)", () => {
    const { lines, logger, sent } = logging();
    const refused = new Db.DatabaseError("Failed query: select count(*): connect ECONNREFUSED");

    const reported = report(logger, jarl.err(refused));

    expect(lines).toEqual([
      "[ERROR] [global] tester: could not count tests: Failed query: select count(*): connect ECONNREFUSED",
    ]);
    expect(jarl.is_err(reported) && reported.error).toBe(refused);
    expect(sent.map(({ error, report: { level, tags } }) => ({ error, level, tags }))).toEqual([
      { error: refused, level: "error", tags: { location: "tester" } },
    ]);
  });
});
