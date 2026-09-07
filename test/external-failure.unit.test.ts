import { describe, expect, it } from "vitest";
import * as ExternalFailure from "../src/external-failure.ts";

describe("messageOf", () => {
  it("reads the message of an Error and of a message-shaped object", () => {
    expect(ExternalFailure.messageOf(new Error("boom"))).toBe("boom");
    expect(ExternalFailure.messageOf({ message: "boom" })).toBe("boom");
  });

  it("is undefined for a string, undefined and an object without a message", () => {
    expect(ExternalFailure.messageOf("text")).toBeUndefined();
    expect(ExternalFailure.messageOf(undefined)).toBeUndefined();
    expect(ExternalFailure.messageOf({ code: 1 })).toBeUndefined();
    expect(ExternalFailure.messageOf({ message: 1 })).toBeUndefined();
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
