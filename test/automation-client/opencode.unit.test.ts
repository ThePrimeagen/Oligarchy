import { describe, expect, it } from "vitest";
import * as OpenCode from "../../src/automation-client/opencode.ts";

const model = (args: ReadonlyArray<string>): string | undefined =>
  args[args.indexOf("--model") + 1];

describe("OpenCode.args", () => {
  it("names oligarchy.json's OpenRouter model under opencode's openrouter provider", () => {
    expect(
      OpenCode.args("diagnose the session", "meta/muse-spark-1.3-contributor", "minimal"),
    ).toEqual([
      "run",
      "--auto",
      "--model",
      "openrouter/meta/muse-spark-1.3-contributor",
      "--variant",
      "minimal",
      "--",
      "diagnose the session",
    ]);
  });

  it("never hands opencode the bare OpenRouter id, which it reads as provider meta (unhappy)", () => {
    const args = OpenCode.args(
      "diagnose the session",
      "meta/muse-spark-1.3-contributor",
      "minimal",
    );
    expect(model(args)).not.toBe("meta/muse-spark-1.3-contributor");
  });

  it("prefixes an OpenRouter id that itself starts with openrouter/", () => {
    expect(model(OpenCode.args("diagnose the session", "openrouter/auto", "minimal"))).toBe(
      "openrouter/openrouter/auto",
    );
  });
});
