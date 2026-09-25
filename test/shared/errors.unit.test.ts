import { describe, expect, it } from "vitest";
import { ErrorReporter, Schema } from "effect";
import * as Errors from "../../src/shared/errors.ts";

describe("Sentry policy", () => {
  it("a LogLine reads as its text and carries the line's level as its severity", () => {
    const cause = new Error("connect ECONNREFUSED 127.0.0.1:5432");
    const fatal = Errors.LogLine.make({
      text: "proxy: database unreachable",
      level: "fatal",
      cause,
    });
    expect(fatal.message).toBe("proxy: database unreachable");
    expect(fatal.cause).toBe(cause);
    expect(ErrorReporter.getSeverity(fatal)).toBe("Fatal");
    expect(ErrorReporter.isIgnored(fatal)).toBe(false);
    const error = Errors.LogLine.make({ text: "timeout cleanup failed: boom", level: "error" });
    expect(ErrorReporter.getSeverity(error)).toBe("Error");
    expect(error.cause).toBeUndefined();
  });
});

describe("domain error messages", () => {
  it("MissingVariable renders <NAME> is not set", () => {
    expect(Errors.MissingVariable.make({ name: "OLIGARCHY_TOKEN" }).message).toBe(
      "OLIGARCHY_TOKEN is not set",
    );
    expect(String(Errors.MissingVariable.make({ name: "X" }))).toContain("X is not set");
  });

  it("QmpTimeout names the command", () => {
    expect(Errors.QmpTimeout.make({ command: "send-key" }).message).toBe(
      "qemu: send-key timed out",
    );
  });

  it("QmpError renders class: desc and keeps the raw frame", () => {
    const raw = { error: { class: "GenericError", desc: "boom" }, id: 1 };
    const error = Errors.QmpError.make({
      command: "send-key",
      class: "GenericError",
      desc: "boom",
      raw,
    });
    expect(error.message).toBe("GenericError: boom");
    expect(error.raw).toEqual(raw);
  });

  it("HostRequirementsMissing joins the list with newlines", () => {
    expect(
      Errors.HostRequirementsMissing.make({
        missing: ["qemu-system-x86_64 not on PATH", "OVMF code not found: /x"],
      }).message,
    ).toBe("missing host requirements:\nqemu-system-x86_64 not on PATH\nOVMF code not found: /x");
  });

  it("ChildExit renders its stderr", () => {
    expect(
      Errors.ChildExit.make({ command: "client", code: 1, stderr: "OLIGARCHY_TOKEN is not set" })
        .message,
    ).toBe("OLIGARCHY_TOKEN is not set");
  });

  it("DatabaseError keeps the driver message and an optional cause", () => {
    const cause = new Error("connect ECONNREFUSED 127.0.0.1:5432");
    const error = Errors.DatabaseError.make({
      operation: "insertLog",
      message: "Failed query: insert into logs",
      cause,
    });
    expect(error.message).toBe("Failed query: insert into logs");
    expect(error.cause).toBe(cause);
    expect(Errors.DatabaseError.make({ operation: "ping", message: "x" }).cause).toBeUndefined();
  });

  it("JobNotFound fills its one message and refuses any other", () => {
    const error = Errors.JobNotFound.make({
      jobId: "job-1",
      url: "http://10.0.0.9:4000",
      cause: new Error("404"),
    });
    expect(error.message).toBe(`Job had "running" status but 404'd.`);
    expect(() =>
      Schema.decodeUnknownSync(Errors.JobNotFound)({
        _tag: "JobNotFound",
        message: "gone",
        jobId: "job-1",
        url: "http://10.0.0.9:4000",
        cause: null,
      }),
    ).toThrow();
  });

  it("every class carries its short tag", () => {
    expect(Errors.CommandError.make({ message: "x" })._tag).toBe("CommandError");
    expect(Errors.QmpClosed.make({ message: "qemu: closed" })._tag).toBe("QmpClosed");
    expect(Errors.QmpProtocolError.make({ message: "x" })._tag).toBe("QmpProtocolError");
    expect(Errors.QemuStartError.make({ message: "x" })._tag).toBe("QemuStartError");
    expect(Errors.IsoError.make({ message: "x" })._tag).toBe("IsoError");
    expect(Errors.KeysError.make({ message: "x" })._tag).toBe("KeysError");
    expect(Errors.ProxyRefusal.make({ status: 409, message: "x" })._tag).toBe("ProxyRefusal");
    expect(Errors.ProxyUnreachable.make({ message: "x", cause: 1 })._tag).toBe("ProxyUnreachable");
    expect(Errors.LinearError.make({ operation: "team", message: "x" })._tag).toBe("LinearError");
    expect(Errors.PngDecodeError.make({ message: "x" })._tag).toBe("PngDecodeError");
    expect(Errors.LogLine.make({ text: "x", level: "error" })._tag).toBe("LogLine");
    expect(Errors.CliFailed.make({ command: "tool", message: "x" })._tag).toBe("CliFailed");
  });
});
