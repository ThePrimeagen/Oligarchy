import { describe, expect, it } from "vitest";
import { Schema } from "effect";
import * as Errors from "../src/errors.ts";

describe("MissingVariable", () => {
  it("renders <NAME> is not set and never the value (happy)", () => {
    const error = Errors.MissingVariable.make({ name: "OLIGARCHY_TOKEN" });
    expect(error.message).toBe("OLIGARCHY_TOKEN is not set");
    expect(error._tag).toBe("MissingVariable");
    expect(String(Errors.MissingVariable.make({ name: "X" }))).toContain("X is not set");
  });

  it("refuses a decode without the name (unhappy)", () => {
    const decode = Schema.decodeUnknownSync(Errors.MissingVariable);
    expect(() => decode({ _tag: "MissingVariable" })).toThrow();
    expect(() => decode({ _tag: "MissingVariable", name: 42 })).toThrow();
  });
});
