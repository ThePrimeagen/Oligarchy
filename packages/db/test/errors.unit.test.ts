import { describe, expect, it } from "vitest";
import { Schema } from "effect";
import * as Errors from "../src/errors.ts";

describe("DatabaseError", () => {
  it("keeps the driver's message and the operation, and an optional cause (happy)", () => {
    const cause = new Error("connect ECONNREFUSED 127.0.0.1:5432");
    const error = Errors.DatabaseError.make({
      operation: "insertLog",
      message: "Failed query: insert into logs",
      cause,
    });
    expect(error.message).toBe("Failed query: insert into logs");
    expect(error.operation).toBe("insertLog");
    expect(error.cause).toBe(cause);
    expect(error._tag).toBe("DatabaseError");
    expect(Errors.DatabaseError.make({ operation: "ping", message: "x" }).cause).toBeUndefined();
  });

  it("refuses a decode without the operation or the message (unhappy)", () => {
    const decode = Schema.decodeUnknownSync(Errors.DatabaseError);
    expect(() => decode({ _tag: "DatabaseError", message: "x" })).toThrow();
    expect(() => decode({ _tag: "DatabaseError", operation: "ping" })).toThrow();
  });
});
