import { describe, expect, it } from "vitest";
import * as ExternalFailure from "../src/external-failure.ts";

describe("externalFailure", () => {
  it("carries the name, message and stack of an Error", () => {
    const failure = ExternalFailure.externalFailure(new Error("x"));
    expect(failure.name).toBe("Error");
    expect(failure.message).toBe("x");
    expect(failure.stack).toContain("Error: x");
    expect(failure.code).toBeUndefined();
  });

  it("keeps a subclass name and a string code", () => {
    const error = Object.assign(new TypeError("fetch failed"), { code: "ECONNREFUSED" });
    const failure = ExternalFailure.externalFailure(error);
    expect(failure.name).toBe("TypeError");
    expect(failure.code).toBe("ECONNREFUSED");
  });

  it("stringifies a numeric code", () => {
    const failure = ExternalFailure.externalFailure({ message: "boom", code: 42 });
    expect(failure.code).toBe("42");
    expect(failure.message).toBe("boom");
    expect(failure.name).toBe("ExternalFailure");
  });

  it("falls back for a string", () => {
    const failure = ExternalFailure.externalFailure("just a string");
    expect(failure.name).toBe("ExternalFailure");
    expect(failure.message).toBe("just a string");
    expect(failure.stack).toBeUndefined();
  });

  it("falls back for an object without a message", () => {
    const failure = ExternalFailure.externalFailure({ status: 500 });
    expect(failure.name).toBe("ExternalFailure");
    expect(failure.message).toBe("[object Object]");
  });

  it("falls back for undefined", () => {
    const failure = ExternalFailure.externalFailure(undefined);
    expect(failure.message).toBe("undefined");
  });
});

describe("describeThrowable", () => {
  it("reads the message of an Error", () => {
    expect(ExternalFailure.describeThrowable(new Error("boom"), "fallback")).toBe("boom");
  });

  it("reads the message of a message-shaped object", () => {
    expect(ExternalFailure.describeThrowable({ message: "boom" }, "fallback")).toBe("boom");
  });

  it("uses the fallback for undefined, a string and an object without a message", () => {
    expect(ExternalFailure.describeThrowable(undefined, "fallback")).toBe("fallback");
    expect(ExternalFailure.describeThrowable("text", "fallback")).toBe("fallback");
    expect(ExternalFailure.describeThrowable({ code: 1 }, "fallback")).toBe("fallback");
  });
});

describe("causeOf", () => {
  it("returns the nested cause when present", () => {
    const inner = new Error("connect ECONNREFUSED");
    expect(ExternalFailure.causeOf(new Error("Failed query", { cause: inner }))).toBe(inner);
    expect(ExternalFailure.causeOf({ cause: "text" })).toBe("text");
  });

  it("returns the value itself when it has no cause", () => {
    const error = new Error("bare");
    expect(ExternalFailure.causeOf(error)).toBe(error);
    expect(ExternalFailure.causeOf("text")).toBe("text");
    expect(ExternalFailure.causeOf(undefined)).toBeUndefined();
  });

  it("returns the value itself when the cause key holds undefined", () => {
    const error = new Error("bare", { cause: undefined });
    expect(ExternalFailure.causeOf(error)).toBe(error);
  });
});
