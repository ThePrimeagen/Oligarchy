import { describe, expect, it } from "vitest";
import { Schema } from "effect";
import * as Errors from "../src/errors.ts";

describe("LinearError", () => {
  it("carries the operation and the message, and an optional status and cause (happy)", () => {
    const cause = new Error("connect ECONNREFUSED 127.0.0.1:1");
    const error = Errors.LinearError.make({
      operation: "teamId",
      message: "linear: request failed",
      status: 502,
      cause,
    });
    expect(error._tag).toBe("LinearError");
    expect(error.message).toBe("linear: request failed");
    expect(error.operation).toBe("teamId");
    expect(error.status).toBe(502);
    expect(error.cause).toBe(cause);
    const bare = Errors.LinearError.make({ operation: "teamId", message: "x" });
    expect(bare.status).toBeUndefined();
    expect(bare.cause).toBeUndefined();
  });

  it("refuses a decode without the operation or the message, or with a fractional status (unhappy)", () => {
    const decode = Schema.decodeUnknownSync(Errors.LinearError);
    expect(() => decode({ _tag: "LinearError", message: "x" })).toThrow();
    expect(() => decode({ _tag: "LinearError", operation: "teamId" })).toThrow();
    expect(() =>
      decode({ _tag: "LinearError", operation: "teamId", message: "x", status: 4.5 }),
    ).toThrow();
  });
});
