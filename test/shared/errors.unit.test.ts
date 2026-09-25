import { describe, expect, it } from "vitest";
import { Schema } from "effect";
import * as Errors from "../../src/shared/errors.ts";

describe("staged errors, each waiting for its package", () => {
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
    expect(Errors.QmpClosed.make({ message: "qemu: closed" })._tag).toBe("QmpClosed");
    expect(Errors.QmpProtocolError.make({ message: "x" })._tag).toBe("QmpProtocolError");
    expect(Errors.QemuStartError.make({ message: "x" })._tag).toBe("QemuStartError");
    expect(Errors.IsoError.make({ message: "x" })._tag).toBe("IsoError");
    expect(Errors.KeysError.make({ message: "x" })._tag).toBe("KeysError");
    expect(Errors.ProxyRefusal.make({ status: 409, message: "x" })._tag).toBe("ProxyRefusal");
    expect(Errors.ProxyUnreachable.make({ message: "x", cause: 1 })._tag).toBe("ProxyUnreachable");
    expect(Errors.PngDecodeError.make({ message: "x" })._tag).toBe("PngDecodeError");
    expect(Errors.CliFailed.make({ command: "tool", message: "x" })._tag).toBe("CliFailed");
  });
});
