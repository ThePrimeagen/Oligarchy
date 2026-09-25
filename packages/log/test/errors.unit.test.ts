import { describe, expect, it } from "vitest";
import { ErrorReporter, Schema } from "effect";
import * as Errors from "../src/errors.ts";

describe("LogLine", () => {
  it("reads as its text and carries the line's level as its severity (happy)", () => {
    const cause = new Error("connect ECONNREFUSED 127.0.0.1:5432");
    const fatal = Errors.LogLine.make({
      text: "proxy: database unreachable",
      level: "fatal",
      cause,
    });
    expect(fatal.message).toBe("proxy: database unreachable");
    expect(fatal.cause).toBe(cause);
    expect(fatal._tag).toBe("LogLine");
    expect(ErrorReporter.getSeverity(fatal)).toBe("Fatal");
    expect(ErrorReporter.isIgnored(fatal)).toBe(false);
    const error = Errors.LogLine.make({ text: "timeout cleanup failed: boom", level: "error" });
    expect(ErrorReporter.getSeverity(error)).toBe("Error");
    expect(error.cause).toBeUndefined();
  });

  // Sentry groups on the name, so the identifier stays where the line was first reported from.
  it("keeps its identifier and refuses a level a reporter would not raise (unhappy)", () => {
    expect(Errors.LogLine.identifier).toBe("@oligarchy/observability/log/LogLine");
    const decode = Schema.decodeUnknownSync(Errors.LogLine);
    expect(() => decode({ _tag: "LogLine", text: "x", level: "info" })).toThrow();
    expect(() => decode({ _tag: "LogLine", level: "error" })).toThrow();
  });
});
