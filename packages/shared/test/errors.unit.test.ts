import { describe, expect, it } from "vitest";
import { Schema } from "effect";
import * as Errors from "../src/errors.ts";

describe("CommandError", () => {
  it("carries the sentence a CLI prints and its short tag (happy)", () => {
    const error = Errors.CommandError.make({ message: "--x and --y need --to-x and --to-y" });
    expect(error.message).toBe("--x and --y need --to-x and --to-y");
    expect(error._tag).toBe("CommandError");
    expect(String(error)).toContain("--x and --y need --to-x and --to-y");
  });

  it("refuses a decode without the sentence or under another tag (unhappy)", () => {
    const decode = Schema.decodeUnknownSync(Errors.CommandError);
    expect(() => decode({ _tag: "CommandError" })).toThrow();
    expect(() => decode({ _tag: "Refusal", message: "x" })).toThrow();
  });
});
