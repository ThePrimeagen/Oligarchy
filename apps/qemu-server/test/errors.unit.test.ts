import { describe, expect, it } from "vitest";
import * as Errors from "../src/errors.ts";

describe("qemu-server errors", () => {
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
});
