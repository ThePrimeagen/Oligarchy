import type * as App from "@oligarchy/app";
import { describe, expect, expectTypeOf, it } from "vitest";
import type * as Logger from "../src/main.ts";
import * as Render from "../src/render.ts";
import * as LoggerTesting from "../src/testing.ts";

describe("the fake logger", () => {
  it("prints each line at once as the logger renders it, and keeps what each call said (happy)", async () => {
    const { lines, said, logger } = LoggerTesting.logger();
    expectTypeOf(logger).toEqualTypeOf<App.Made<Logger.Logger>>();

    logger.info("booted", { jobId: "OLI-1", location: "s-1" });
    expect(lines).toEqual(["[INFO] [OLI-1] s-1: booted"]);
    logger.warning("slow");
    await logger.flush();

    expect(lines).toEqual(["[INFO] [OLI-1] s-1: booted", "[WARN] [global] slow"]);
    expect(said).toEqual([
      { level: "info", text: "booted", report: { jobId: "OLI-1", location: "s-1" } },
      { level: "warning", text: "slow", report: {} },
    ]);
  });

  it("keeps an error's cause and skipSentry as given, and paints a job when asked (unhappy)", () => {
    const { lines, said, logger } = LoggerTesting.logger({ colors: true, now: () => 0 });
    const cause = new Error("connect ECONNREFUSED");

    logger.error("stop failed", { jobId: "A", cause });
    logger.fatal("shutting down", { skipSentry: true });

    const color = Render.JOB_COLORS[0];
    expect(lines).toEqual([
      Render.renderLine(
        {
          text: "stop failed",
          level: "error",
          jobId: "A",
          ...(color === undefined ? {} : { color }),
        },
        true,
      ),
      Render.renderLine({ text: "shutting down", level: "fatal" }, true),
    ]);
    expect(said).toEqual([
      { level: "error", text: "stop failed", report: { jobId: "A", cause } },
      { level: "fatal", text: "shutting down", report: { skipSentry: true } },
    ]);
  });
});
